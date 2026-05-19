import type { Context } from "probot";
import type { GitHubIssue, PipelineResult, RepoConfig } from "./types.js";
import { LLMClient } from "./llm/client.js";
import { loadConfig } from "./config/loader.js";
import { sanitizeIssueBody, sanitizeIssueTitle } from "./sanitizer.js";
import { classifyIssue } from "./classifier.js";
import { draftReply } from "./replier.js";
import { resolveLabels, applyLabels } from "./github/labels.js";

function shouldExclude(
  context: Context<"issues.opened">,
  config: RepoConfig,
): boolean {
  const issue = context.payload.issue;
  const existingLabels = (issue.labels ?? []).map((l: { name: string }) => l.name);

  if (issue.user && config.exclude.users.includes(issue.user.login)) {
    return true;
  }

  for (const label of existingLabels) {
    if (config.exclude.labels.includes(label)) {
      return true;
    }
  }

  return false;
}

export async function runPipeline(
  context: Context<"issues.opened">,
): Promise<PipelineResult> {
  const result: PipelineResult = {
    classification: null,
    labelsApplied: [],
    replyPosted: false,
    errors: [],
  };

  const log = context.log;

  let config: RepoConfig;
  try {
    config = await loadConfig(context);
  } catch (error) {
    log.error({ err: error }, "Failed to load config");
    result.errors.push({
      step: "classify",
      message: "Config loading failed",
      cause: error instanceof Error ? error : new Error(String(error)),
    });
    return result;
  }

  if (!config.enabled) {
    log.info("Bot disabled for this repo, skipping");
    return result;
  }

  if (shouldExclude(context, config)) {
    log.info("Issue excluded by config, skipping");
    return result;
  }

  const issue: GitHubIssue = {
    number: context.payload.issue.number,
    title: context.payload.issue.title,
    body: context.payload.issue.body ?? null,
    html_url: context.payload.issue.html_url,
    user: { login: context.payload.issue.user?.login ?? "unknown" },
    labels: (context.payload.issue.labels ?? []).map(
      (l: { name: string; id: number }) => ({ name: l.name, id: l.id }),
    ),
    created_at: context.payload.issue.created_at,
  };

  const sanitizedTitle = sanitizeIssueTitle(issue.title);
  const sanitizedBody = sanitizeIssueBody(issue.body, config);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const devMode = !apiKey;

  if (devMode) {
    log.warn("ANTHROPIC_API_KEY not set — running in dev mode with mock responses");
  }

  const llmClient = apiKey ? new LLMClient(apiKey, log) : null;

  if (config.features.classify) {
    try {
      if (devMode || !llmClient) {
        result.classification = {
          category: "bug" as const,
          priority: "medium" as const,
          confidence: 0.5,
          summary: `[DEV MODE] ${issue.title}`,
          suggestedLabels: ["bug"],
          reasoning: "Mock classification (ANTHROPIC_API_KEY not set)",
        };
        log.info({ issueNumber: issue.number, devMode: true }, "Mock classification applied");
      } else {
        result.classification = await classifyIssue(
          issue, sanitizedBody, sanitizedTitle, config, llmClient, log,
        );
      }

      try {
        const labels = resolveLabels(result.classification, config);
        result.labelsApplied = await applyLabels(context, labels);
        log.info({ labels: result.labelsApplied }, "Labels applied");
      } catch (error) {
        result.errors.push({
          step: "label",
          message: "Failed to apply labels",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    } catch (error) {
      result.errors.push({
        step: "classify",
        message: "Classification failed",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  if (config.features.reply) {
    try {
      let replyBody: string;
      if (devMode || !llmClient) {
        const classification = result.classification ?? {
          category: "question" as const,
          priority: "medium" as const,
        };
        replyBody = [
          `**[DEV MODE]** This is a mock reply (ANTHROPIC_API_KEY not set).\n`,
          `Classification: **${classification.category}** (priority: ${classification.priority})`,
          "",
          "Once configured with an API key, this bot will generate contextual replies.",
          "",
          "-- Issue AI Agent :robot:",
        ].join("\n");
      } else {
        replyBody = await draftReply(
          issue,
          result.classification ?? {
            category: "question" as const,
            priority: "medium" as const,
            confidence: 0,
            summary: "",
            suggestedLabels: [],
            reasoning: "Fallback: classification unavailable",
          },
          sanitizedBody,
          sanitizedTitle,
          config,
          llmClient,
          log,
        );
      }

      await context.octokit.rest.issues.createComment(
        context.issue({ body: replyBody }),
      );
      result.replyPosted = true;
      log.info("Reply comment posted");
    } catch (error) {
      result.errors.push({
        step: "reply",
        message: "Reply drafting/posting failed",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  return result;
}
