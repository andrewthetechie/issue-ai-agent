import type { IssueClassification, Logger, RepoConfig } from "../types.js";
import { normalizeServerUrl } from "../utils.js";

const LABEL_PAGE_LIMIT = 100;
const MAX_LABEL_PAGES = 100; // safety bound: 100 pages * 100/page = 10k labels
const DEFAULT_LABEL_COLOR = "#ededed";

export function resolveLabels(
  classification: IssueClassification,
  config: RepoConfig,
): string[] {
  const mappedLabels: string[] = [];

  const categoryLabels = config.labelMapping[classification.category];
  if (categoryLabels && categoryLabels.length > 0) {
    mappedLabels.push(...categoryLabels);
  }

  const priorityLabels = config.priorityLabelMapping[classification.priority] ?? [];
  mappedLabels.push(...priorityLabels);

  return [...new Set(mappedLabels)];
}

export async function applyLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  logger: Logger,
): Promise<string[]> {
  if (labels.length === 0) return [];

  try {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    });
    return labels;
  } catch (error) {
    logger.warn({ err: error, labels }, "Bulk label add failed, trying one by one");

    const applied: string[] = [];
    for (const label of labels) {
      try {
        await octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: issueNumber,
          labels: [label],
        });
        applied.push(label);
      } catch {
        logger.warn({ label }, "Failed to add label");
      }
    }
    return applied;
  }
}

/**
 * Ensures every label referenced by config.labelMapping / config.priorityLabelMapping
 * exists in the repo, creating only the missing ones. Idempotent and best-effort.
 *
 * Failure contract is intentionally asymmetric:
 *  - The existing-labels list call THROWS on failure; the caller (runPipeline) records
 *    a `createLabels` PipelineError and continues the rest of the pipeline.
 *  - Individual create failures are swallowed with a warning (one bad label never aborts
 *    the rest). A `422` whose message contains "already exists" is treated as a benign
 *    list/create race and swallowed silently.
 */
export async function ensureLabelsExist(
  owner: string,
  repo: string,
  config: RepoConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  logger: Logger,
): Promise<void> {
  // 1. Build desired set from both maps
  const desiredLabels = new Set<string>();
  for (const labels of Object.values(config.labelMapping)) {
    for (const label of labels) {
      desiredLabels.add(label);
    }
  }
  for (const labels of Object.values(config.priorityLabelMapping)) {
    for (const label of labels) {
      desiredLabels.add(label);
    }
  }

  // 2. List existing labels with pagination
  const existingNames = new Set<string>();
  let page = 1;
  while (page <= MAX_LABEL_PAGES) {
    const response = await octokit.request("GET /repos/{owner}/{repo}/labels", {
      owner,
      repo,
      limit: LABEL_PAGE_LIMIT,
      page,
    });
    const labels = response.data;
    if (labels.length === 0) {
      break;
    }
    for (const label of labels) {
      existingNames.add(label.name);
    }
    page++;
  }

  // 3. Diff
  const missingLabels = [...desiredLabels].filter(
    (name) => !existingNames.has(name),
  );

  // 4. Create missing
  for (const name of missingLabels) {
    try {
      await octokit.request("POST /repos/{owner}/{repo}/labels", {
        owner,
        repo,
        name,
        color: DEFAULT_LABEL_COLOR,
        description: "",
      });
    } catch (error) {
      const err = error as { status?: number; message?: string };
      if (
        err.status === 422 &&
        err.message?.toLowerCase().includes("already exists")
      ) {
        // Swallow - race condition between list and create
        continue;
      }
      logger.warn({ label: name }, "Failed to create label");
    }
  }
}

/**
 * Removes a label from an issue by label id via the Forgejo API.
 *
 * Endpoint: DELETE /api/v1/repos/{owner}/{repo}/issues/{issueIndex}/labels/{labelId}
 *
 * A 404 response (label not present on the issue) is treated as success
 * because the desired end state is "label absent".
 */
export async function removeLabelFromIssue(
  serverUrl: string,
  owner: string,
  repo: string,
  issueIndex: number,
  labelId: number,
  token: string,
): Promise<void> {
  const baseUrl = normalizeServerUrl(serverUrl);
  const url = `${baseUrl}/api/v1/repos/${owner}/${repo}/issues/${issueIndex}/labels/${labelId}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `token ${token}`,
    },
  });

  if (response.status === 404) {
    // Label not present on the issue — desired end state is "label absent"
    return;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`removeLabelFromIssue failed: ${response.status} ${response.statusText} — ${body}`);
  }

  return;
}
