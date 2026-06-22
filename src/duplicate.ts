import type { Logger } from "./types.js";
import type { Issue, RelatedIssue, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
import { DUPLICATE_SYSTEM_PROMPT, buildDuplicateUserMessage } from "./prompts/duplicate.js";

/**
 * Posts a static duplicate-comment in batch mode.
 *
 * This is a templated comment (no LLM call) that lists detected duplicate
 * issue numbers/links. It is used only in batch mode because the event-driven
 * pipeline embeds duplicates into the LLM reply instead.
 *
 * Failure to post this comment does NOT block triage label removal.
 */
export async function postDuplicateComment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  owner: string,
  repo: string,
  issueNumber: number,
  relatedIssues: RelatedIssue[],
): Promise<void> {
  const lines = [
    ":robot: **Duplicate issue(s) detected**",
    "",
    "The following issues appear to be duplicates of this one:",
    "",
    ...relatedIssues.map((ri) => `- #${ri.number} — [${ri.title}](${ri.url})`),
    "",
    "-- Issue AI Agent",
  ].join("\n");

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: lines,
  });
}

export interface DuplicateResponse {
  duplicates: number[];
  reasoning: string;
}

export function parseDuplicateResponse(raw: string): DuplicateResponse {
  const stripped = raw.trim();

  let jsonStr = stripped;
  const codeBlockMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      duplicates: Array.isArray(parsed.duplicates)
        ? parsed.duplicates.filter((n: unknown) => typeof n === "number")
        : [],
      reasoning: typeof parsed.reasoning === "string"
        ? parsed.reasoning.slice(0, 300)
        : "No reasoning provided",
    };
  } catch {
    return { duplicates: [], reasoning: "Failed to parse duplicate detection response" };
  }
}

export async function detectDuplicates(
  issue: Issue,
  candidates: RelatedIssue[],
  llmClient: LLMProvider,
  config: RepoConfig,
  log: Logger,
): Promise<RelatedIssue[]> {
  if (candidates.length === 0) {
    return [];
  }

  const userMessage = buildDuplicateUserMessage(
    { title: issue.title, body: issue.body },
    candidates,
  );

  const response = await llmClient.complete(
    config.llm.model,
    config.prompts?.duplicate ?? DUPLICATE_SYSTEM_PROMPT,
    [{ role: "user", content: userMessage }],
    config.llm.maxTokens,
  );

  const result = parseDuplicateResponse(response.text);

  log.info(
    { duplicateNumbers: result.duplicates, reasoning: result.reasoning },
    "Duplicate detection completed",
  );

  return candidates.filter((c) => result.duplicates.includes(c.number));
}
