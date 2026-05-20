import type { Logger } from "pino";
import type { GitHubIssue, RelatedIssue, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
import { DUPLICATE_SYSTEM_PROMPT, buildDuplicateUserMessage } from "./prompts/duplicate.js";

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
  issue: GitHubIssue,
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
    DUPLICATE_SYSTEM_PROMPT,
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
