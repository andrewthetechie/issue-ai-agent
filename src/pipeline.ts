import type { ActionContext, Issue, Logger, PipelineResult, RepoConfig } from "./types.js";
import { createProvider, detectProvider } from "./llm/factory.js";
import type { ProviderName } from "./llm/factory.js";
import { loadConfig } from "./config/loader.js";
import { sanitizeIssueBody, sanitizeIssueTitle } from "./sanitizer.js";
import { classifyIssue } from "./classifier.js";
import { draftReply } from "./replier.js";
import { resolveLabels, applyLabels } from "./forgejo/labels.js";
import { searchSimilarIssues } from "./forgejo/search.js";
import { detectDuplicates } from "./duplicate.js";

function shouldExclude(
  payload: ActionContext["payload"],
  config: RepoConfig,
): boolean {
  const issue = payload.issue;
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
  actx: ActionContext,
  serverUrl: string,
  token: string,
): Promise<PipelineResult> {
  const result: PipelineResult = {
    classification: null,
    labelsApplied: [],
    replyPosted: false,
    errors: [],
  };

  const log: Logger = actx.logger;

  let config: RepoConfig;
  try {
    config = await loadConfig(actx.owner, actx.repo, actx.octokit, actx.configPath);
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

  if (shouldExclude(actx.payload, config)) {
    log.info("Issue excluded by config, skipping");
    return result;
  }

  const issue: Issue = {
    number: actx.payload.issue.number,
    title: actx.payload.issue.title,
    body: actx.payload.issue.body ?? null,
    html_url: actx.payload.issue.html_url,
    user: { login: actx.payload.issue.user?.login ?? "unknown" },
    labels: (actx.payload.issue.labels ?? []).map(
      (l: { name: string; id: number }) => ({ name: l.name, id: l.id }),
    ),
    created_at: actx.payload.issue.created_at,
  };

  const sanitizedTitle = sanitizeIssueTitle(issue.title);
  const sanitizedBody = sanitizeIssueBody(issue.body, config);

  const providerName = (config.llm.provider ?? detectProvider()) as ProviderName;
  const llmClient = createProvider(providerName, log);

  if (!llmClient) {
    log.warn("No LLM API key configured — running in dev mode with mock responses");
  }

  if (config.features.classify) {
    try {
      if (!llmClient) {
        result.classification = {
          category: "bug" as const,
          priority: "medium" as const,
          confidence: 0.5,
          summary: `[DEV MODE] ${issue.title}`,
          suggestedLabels: ["bug"],
          reasoning: "Mock classification (no LLM API key configured)",
        };
        log.info({ issueNumber: issue.number, devMode: true }, "Mock classification applied");
      } else {
        result.classification = await classifyIssue(
          issue, sanitizedBody, sanitizedTitle, config, llmClient, log,
        );
      }

      try {
        const labels = resolveLabels(result.classification, config);
        result.labelsApplied = await applyLabels(
          actx.owner, actx.repo, actx.payload.issue.number,
          labels, actx.octokit, actx.logger,
        );
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

  if (config.features.duplicateSearch && llmClient) {
    try {
      const candidates = await searchSimilarIssues(
        actx.owner, actx.repo, sanitizedTitle, issue.number, serverUrl, token,
      );
      if (candidates.length > 0) {
        log.info({ candidateCount: candidates.length }, "Found similar issues, checking for duplicates");
        const duplicates = await detectDuplicates(
          issue, candidates, llmClient, config, log,
        );
        if (result.classification) {
          result.classification.relatedIssues = duplicates;
        }
        log.info({ duplicateCount: duplicates.length }, "Duplicate detection completed");
      }
    } catch (error) {
      result.errors.push({
        step: "duplicate",
        message: "Duplicate detection failed",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  if (config.features.reply) {
    try {
      let replyBody: string;
      if (!llmClient) {
        const classification = result.classification ?? {
          category: "question" as const,
          priority: "medium" as const,
        };
        replyBody = [
          `**[DEV MODE]** This is a mock reply (no LLM API key configured).\n`,
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

      await actx.octokit.rest.issues.createComment({
        owner: actx.owner,
        repo: actx.repo,
        issue_number: actx.payload.issue.number,
        body: replyBody,
      });
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
