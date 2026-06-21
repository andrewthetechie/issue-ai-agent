import type { IssueClassification, Logger, RepoConfig } from "../types.js";

const LABEL_PAGE_LIMIT = 100;

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
  while (true) {
    const response = await octokit.request("GET /repos/{owner}/{repo}/labels", {
      owner,
      repo,
      limit: LABEL_PAGE_LIMIT,
      page,
    });
    const labels = response.data;
    for (const label of labels) {
      existingNames.add(label.name);
    }
    if (labels.length < LABEL_PAGE_LIMIT) {
      break;
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
        color: "ededed",
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
