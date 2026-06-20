import type { Logger } from "./types.js";
import type { Issue, IssueClassification, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
import { REPLY_SYSTEM_PROMPT, buildReplyUserMessage } from "./prompts/reply.js";

const MAX_REPLY_LENGTH = 4000;

export async function draftReply(
  issue: Issue,
  classification: IssueClassification,
  sanitizedBody: string,
  sanitizedTitle: string,
  config: RepoConfig,
  llmClient: LLMProvider,
  logger: Logger,
): Promise<string> {
  const userMessage = buildReplyUserMessage(
    sanitizedTitle,
    sanitizedBody,
    classification.category,
    classification.priority,
    issue.labels.map((l) => l.name),
    classification.relatedIssues,
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
