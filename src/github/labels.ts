import type { Context } from "probot";
import type { IssueClassification, RepoConfig } from "../types.js";

export function resolveLabels(
  classification: IssueClassification,
  config: RepoConfig,
): string[] {
  const mappedLabels: string[] = [];

  const categoryLabels = config.labelMapping[classification.category];
  if (categoryLabels && categoryLabels.length > 0) {
    mappedLabels.push(...categoryLabels);
  }

  mappedLabels.push(`priority: ${classification.priority}`);

  return [...new Set(mappedLabels)];
}

export async function applyLabels(
  context: Context<"issues.opened">,
  labels: string[],
): Promise<string[]> {
  if (labels.length === 0) return [];

  const { owner, repo } = context.repo();
  const issueNumber = context.payload.issue.number;

  try {
    await context.octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    });
    return labels;
  } catch (error) {
    context.log.warn({ err: error, labels }, "Bulk label add failed, trying one by one");

    const applied: string[] = [];
    for (const label of labels) {
      try {
        await context.octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: issueNumber,
          labels: [label],
        });
        applied.push(label);
      } catch {
        context.log.warn({ label }, "Failed to add label");
      }
    }
    return applied;
  }
}
