import yaml from "js-yaml";
import type { Logger, RawPromptsConfig, RepoConfig } from "../types.js";
import { DEFAULT_CONFIG } from "./schema.js";
import { resolvePrompts } from "../prompts/resolver.js";

export async function loadConfig(
  owner: string,
  repo: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  logger: Logger,
  configPath: string = ".forgejo/issue-ai.yml",
): Promise<RepoConfig> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let repoConfig: any;

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: configPath,
    });

    if ("content" in data && typeof data.content === "string") {
      const yamlText = Buffer.from(data.content, "base64").toString("utf-8");
      repoConfig = yaml.load(yamlText);
    } else {
      return DEFAULT_CONFIG;
    }
  } catch (error: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((error as any).status === 404) {
      return DEFAULT_CONFIG;
    }
    throw error;
  }

  if (!repoConfig) {
    return DEFAULT_CONFIG;
  }

  // Extract raw prompts config and normalize snake_case to camelCase
  const rawPrompts: RawPromptsConfig | undefined = repoConfig.prompts
    ? {
        classify: repoConfig.prompts.classify,
        reply: repoConfig.prompts.reply,
        duplicate: repoConfig.prompts.duplicate,
        commentReply:
          repoConfig.prompts.commentReply ?? repoConfig.prompts.comment_reply,
      }
    : undefined;

  // Resolve prompts (file-based and inline)
  const resolvedPrompts = await resolvePrompts(
    rawPrompts,
    owner,
    repo,
    octokit,
    logger,
  );

  // Validate unknown keys in label_mapping
  if (repoConfig.label_mapping) {
    const knownLabelKeys = new Set(Object.keys(DEFAULT_CONFIG.labelMapping));
    for (const key of Object.keys(repoConfig.label_mapping)) {
      if (!knownLabelKeys.has(key)) {
        logger.warn({ key }, "Unknown label_mapping key ignored");
      }
    }
  }

  // Validate unknown keys in priority_label_mapping
  if (repoConfig.priority_label_mapping) {
    const knownPriorityKeys = new Set(Object.keys(DEFAULT_CONFIG.priorityLabelMapping));
    for (const key of Object.keys(repoConfig.priority_label_mapping)) {
      if (!knownPriorityKeys.has(key)) {
        logger.warn({ key }, "Unknown priority_label_mapping key ignored");
      }
    }
  }

  return {
    enabled: repoConfig.enabled ?? DEFAULT_CONFIG.enabled,
    createLabels: repoConfig.create_labels ?? DEFAULT_CONFIG.createLabels,
    features: {
      classify: repoConfig.features?.classify ?? DEFAULT_CONFIG.features.classify,
      reply: repoConfig.features?.reply ?? DEFAULT_CONFIG.features.reply,
      duplicateSearch: repoConfig.features?.duplicateSearch ?? DEFAULT_CONFIG.features.duplicateSearch,
      commentReply: repoConfig.features?.commentReply ?? DEFAULT_CONFIG.features.commentReply,
    },
    labelMapping: repoConfig.label_mapping ?? DEFAULT_CONFIG.labelMapping,
    security: {
      maxIssueLength: repoConfig.security?.max_issue_length ?? DEFAULT_CONFIG.security.maxIssueLength,
    },
    exclude: {
      labels: repoConfig.exclude?.labels ?? DEFAULT_CONFIG.exclude.labels,
      users: repoConfig.exclude?.users ?? DEFAULT_CONFIG.exclude.users,
    },
    batch: {
      triageLabel: repoConfig.batch?.triage_label ?? DEFAULT_CONFIG.batch.triageLabel,
      batchLimit: repoConfig.batch?.batch_limit ?? DEFAULT_CONFIG.batch.batchLimit,
    },
    llm: {
      provider: repoConfig.llm?.provider ?? DEFAULT_CONFIG.llm.provider,
      model: repoConfig.llm?.model ?? DEFAULT_CONFIG.llm.model,
      maxTokens: repoConfig.llm?.max_tokens ?? DEFAULT_CONFIG.llm.maxTokens,
    },
    priorityLabelMapping: repoConfig.priority_label_mapping ?? DEFAULT_CONFIG.priorityLabelMapping,
    prompts: resolvedPrompts,
  };
}
