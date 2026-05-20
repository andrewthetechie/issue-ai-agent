import type { ActionContext, RepoConfig } from "./types.js";
import { loadConfig } from "./config/loader.js";
import { sanitizeIssueBody, sanitizeIssueTitle } from "./sanitizer.js";
import { createProvider, detectProvider } from "./llm/factory.js";
import type { ProviderName } from "./llm/factory.js";
import { COMMENT_REPLY_SYSTEM_PROMPT, buildCommentReplyMessage } from "./prompts/comment-reply.js";

const MAX_COMMENT_REPLY_LENGTH = 4000;
const MAX_COMMENT_LENGTH = 5000;

export async function handleComment(
  actx: ActionContext,
): Promise<void> {
  if (actx.payload.sender?.type === "Bot") {
    return;
  }

  const issue = actx.payload.issue;

  if (issue.pull_request) {
    return;
  }

  const comment = actx.payload.comment;
  if (!comment) {
    return;
  }
  const issueNumber = issue.number;

  actx.logger.info(
    { owner: actx.owner, repo: actx.repo, issueNumber, commentAuthor: comment.user?.login },
    "Comment created on issue",
  );

  let config: RepoConfig;
  try {
    config = await loadConfig(actx.owner, actx.repo, actx.octokit, actx.configPath);
  } catch (error) {
    actx.logger.error({ err: error }, "Failed to load config for comment handler");
    return;
  }

  if (!config.enabled || !config.features.commentReply) {
    return;
  }

  if (comment.user && config.exclude.users.includes(comment.user.login)) {
    return;
  }

  const commentBody = (comment.body ?? "").slice(0, MAX_COMMENT_LENGTH);

  const providerName = (config.llm.provider ?? detectProvider()) as ProviderName;
  const llmClient = createProvider(providerName, actx.logger);

  if (!llmClient) {
    actx.logger.warn("No LLM API key configured, skipping comment reply");
    return;
  }

  const issueTitle = sanitizeIssueTitle(issue.title);
  const issueBody = sanitizeIssueBody(issue.body, config);
  const issueLabels = (issue.labels ?? []).map((l: { name: string }) => l.name);

  const userMessage = buildCommentReplyMessage({
    issueTitle,
    issueBody,
    issueLabels,
    commentAuthor: comment.user?.login ?? "unknown",
    commentBody,
  });

  try {
    const response = await llmClient.complete(
      config.llm.model,
      COMMENT_REPLY_SYSTEM_PROMPT,
      [{ role: "user", content: userMessage }],
      config.llm.maxTokens,
    );

    let replyText = response.text.trim();

    const codeBlockMatch = replyText.match(/```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      replyText = codeBlockMatch[1].trim();
    }

    if (replyText.length > MAX_COMMENT_REPLY_LENGTH) {
      replyText = replyText.substring(0, MAX_COMMENT_REPLY_LENGTH) + "\n\n... (reply truncated)";
    }

    await actx.octokit.rest.issues.createComment({
      owner: actx.owner,
      repo: actx.repo,
      issue_number: issueNumber,
      body: replyText,
    });

    actx.logger.info({ issueNumber, replyLength: replyText.length }, "Comment reply posted");
  } catch (error) {
    actx.logger.error({ err: error, issueNumber }, "Failed to post comment reply");
  }
}
