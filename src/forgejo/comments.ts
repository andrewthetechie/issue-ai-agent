import type { RelatedIssue } from "../types.js";

const SIGN_OFF = "-- Issue AI Agent :robot:";

export async function postDuplicateComment(
  octokit: any,
  owner: string,
  repo: string,
  issueNumber: number,
  duplicates: RelatedIssue[],
): Promise<void> {
  const bulletLines = duplicates
    .map((d) => `- #${d.number}: ${d.title} (${d.url})`)
    .join("\n");

  const body = [
    "🤖 **Possible duplicate issues found**",
    "",
    "This issue looks similar to:",
    "",
    bulletLines || "No specific duplicates identified.",
    "",
    "Maintainers may want to review these before triaging further.",
    "",
    SIGN_OFF,
  ].join("\n");

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

export async function postExcludeRemovalComment(
  octokit: any,
  owner: string,
  repo: string,
  issueNumber: number,
  triageLabel: string,
  reason: "user" | "label",
): Promise<void> {
  const reasonClause =
    reason === "user"
      ? "the issue author is on the configured exclude list"
      : "it carries a configured excluded label";

  const body = [
    `🤖 Removed the \`${triageLabel}\` label from this issue because ${reasonClause}, so it won't be processed by automated batch triage.`,
    "",
    SIGN_OFF,
  ].join("\n");

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}
