import type { Logger } from "pino";
import type { GitHubIssue, IssueClassification, RepoConfig } from "./types.js";
import { LLMClient } from "./llm/client.js";
import { REPLY_SYSTEM_PROMPT, buildReplyUserMessage } from "./prompts/reply.js";

const MAX_REPLY_LENGTH = 4000;

export async function draftReply(
  issue: GitHubIssue,
  classification: IssueClassification,
  sanitizedBody: string,
  sanitizedTitle: string,
  config: RepoConfig,
  llmClient: LLMClient,
  logger: Logger,
): Promise<string> {
  const userMessage = buildReplyUserMessage(
    sanitizedTitle,
    sanitizedBody,
    classification.category,
    classification.priority,
    issue.labels.map((l) => l.name),
  );

  logger.info({ issueNumber: issue.number, category: classification.category }, "Drafting reply");

  const response = await llmClient.complete(
    config.llm.model,
    REPLY_SYSTEM_PROMPT,
    [{ role: "user", content: userMessage }],
    config.llm.maxTokens,
  );

  let replyText = response.text.trim();

  const codeBlockMatch = replyText.match(/```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    replyText = codeBlockMatch[1].trim();
  }

  if (replyText.length > MAX_REPLY_LENGTH) {
    replyText = replyText.substring(0, MAX_REPLY_LENGTH) + "\n\n... (reply truncated)";
  }

  logger.info({ issueNumber: issue.number, replyLength: replyText.length }, "Reply drafted");

  return replyText;
}
