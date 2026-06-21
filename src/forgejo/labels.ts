import type { IssueClassification, Logger, RepoConfig } from "../types.js";

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
