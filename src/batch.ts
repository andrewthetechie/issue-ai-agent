import type { ActionContext, BatchResult, IssueClassification, Logger, RepoConfig } from "./types.js";
import { createProvider, detectProvider } from "./llm/factory.js";
import type { ProviderName } from "./llm/factory.js";
import { loadConfig } from "./config/loader.js";
import { sanitizeIssueBody, sanitizeIssueTitle } from "./sanitizer.js";
import { classifyIssue } from "./classifier.js";
import { resolveLabels, applyLabels, ensureLabelsExist } from "./forgejo/labels.js";
import { shouldExclude } from "./exclude.js";
import { fetchIssuesByLabel, removeLabelFromIssue } from "./forgejo/issues.js";
import { searchSimilarIssues } from "./forgejo/search.js";
import { detectDuplicates } from "./duplicate.js";
import { postDuplicateComment, postExcludeRemovalComment } from "./forgejo/comments.js";

const ZERO_RESULT: BatchResult = { issuesProcessed: 0, issuesFailed: 0 };

export async function runBatchPipeline(
  actx: ActionContext,
  serverUrl: string,
  token: string,
): Promise<BatchResult> {
  const log: Logger = actx.logger;

  // Step 1: Load config
  let config: RepoConfig;
  try {
    config = await loadConfig(actx.owner, actx.repo, actx.octokit, log, actx.configPath);
  } catch (error) {
    log.error({ err: error }, "Failed to load config");
    return ZERO_RESULT;
  }

  // Step 2: Disabled check
  if (!config.enabled) {
    log.info("Batch triage disabled for this repo, skipping");
    return ZERO_RESULT;
  }

  // Step 3: Build LLM client — batch must NOT mock
  const providerName = (config.llm.provider ?? detectProvider()) as ProviderName;
  const llmClient = createProvider(providerName, log);
  if (!llmClient) {
    log.error("No LLM client configured — aborting batch run (misconfigured key must not mass-mislabel)");
    return ZERO_RESULT;
  }

  // Step 4: Ensure labels exist (once, before the loop)
  if (config.createLabels) {
    try {
      await ensureLabelsExist(
        actx.owner, actx.repo, config, actx.octokit, log,
      );
      log.info("Label creation completed");
    } catch (error) {
      log.warn({ err: error }, "Label creation failed — continuing");
    }
  }

  // Step 5: Fetch triage-labeled issues
  const issues = await fetchIssuesByLabel(
    serverUrl,
    actx.owner,
    actx.repo,
    config.batch.triageLabel,
    config.batch.batchLimit,
    token,
  );

  // Step 6: Process sequentially
  let issuesProcessed = 0;
  let issuesFailed = 0;

  for (const issue of issues) {
    // Exclude check — drain: remove triage label + comment, do not count
    if (shouldExclude({ user: issue.user, labels: issue.labels }, config)) {
      const reason: "user" | "label" =
        issue.user && config.exclude.users.includes(issue.user.login) ? "user" : "label";

      log.info({ issueNumber: issue.number, reason }, "Issue excluded, draining");

      try {
        const triageLabel = issue.labels.find(
          (l) => l.name === config.batch.triageLabel,
        );
        if (triageLabel) {
          await removeLabelFromIssue(
            serverUrl,
            actx.owner,
            actx.repo,
            issue.number,
            triageLabel.id,
            token,
          );
        }
        await postExcludeRemovalComment(
          actx.octokit,
          actx.owner,
          actx.repo,
          issue.number,
          config.batch.triageLabel,
          reason,
        );
      } catch (error) {
        log.warn({ err: error, issueNumber: issue.number }, "Exclude-drain failed — continuing");
      }

      continue;
    }

    // Sanitize
    const sanitizedTitle = sanitizeIssueTitle(issue.title);
    const sanitizedBody = sanitizeIssueBody(issue.body, config);

    // Classify (only when enabled)
    let classification: IssueClassification | undefined;
    if (config.features.classify) {
      try {
        classification = await classifyIssue(
          issue, sanitizedBody, sanitizedTitle, config, llmClient, log,
        );
      } catch (error) {
        log.error({ err: error, issueNumber: issue.number }, "Classification failed");
        issuesFailed++;
        continue;
      }

      // Apply labels
      try {
        const labels = resolveLabels(classification, config);
        await applyLabels(
          actx.owner, actx.repo, issue.number, labels, actx.octokit, log,
        );
      } catch (error) {
        log.error({ err: error, issueNumber: issue.number }, "Label application failed");
        issuesFailed++;
        continue;
      }
    }

    // Duplicate detection — separate try/catch so failures don't block triage
    if (config.features.duplicateSearch) {
      try {
        const candidates = await searchSimilarIssues(
          actx.owner, actx.repo, sanitizedTitle, issue.number, serverUrl, token,
        );
        if (candidates.length > 0) {
          const duplicates = await detectDuplicates(
            issue, candidates, llmClient, config, log,
          );
          if (duplicates.length > 0) {
            await postDuplicateComment(
              actx.octokit, actx.owner, actx.repo, issue.number, duplicates,
            );
            log.info({ duplicateCount: duplicates.length }, "Duplicate comment posted");
          }
        }
      } catch (error) {
        log.warn({ err: error, issueNumber: issue.number }, "Duplicate detection/comment failed — proceeding");
      }
    }

    // Remove triage label
    const triageLabel = issue.labels.find(
      (l) => l.name === config.batch.triageLabel,
    );
    if (triageLabel) {
      try {
        await removeLabelFromIssue(
          serverUrl,
          actx.owner,
          actx.repo,
          issue.number,
          triageLabel.id,
          token,
        );
        issuesProcessed++;
      } catch (error) {
        log.error({ err: error, issueNumber: issue.number }, "Label removal failed");
        issuesFailed++;
      }
    } else {
      // Label not found on issue — treat as processed (desired state reached)
      issuesProcessed++;
    }
  }

  return { issuesProcessed, issuesFailed };
}
