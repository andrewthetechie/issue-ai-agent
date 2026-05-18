import type { Context } from "probot";
import type { RepoConfig } from "../types.js";
import { DEFAULT_CONFIG } from "./schema.js";

export async function loadConfig(
  context: Context<"issues.opened">,
): Promise<RepoConfig> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repoConfig: any = await context.config("issue-ai.yml");

  if (!repoConfig) {
    return DEFAULT_CONFIG;
  }

  return {
    enabled: repoConfig.enabled ?? DEFAULT_CONFIG.enabled,
    features: {
      classify: repoConfig.features?.classify ?? DEFAULT_CONFIG.features.classify,
      reply: repoConfig.features?.reply ?? DEFAULT_CONFIG.features.reply,
    },
    labelMapping: repoConfig.label_mapping ?? DEFAULT_CONFIG.labelMapping,
    security: {
      maxIssueLength: repoConfig.security?.max_issue_length ?? DEFAULT_CONFIG.security.maxIssueLength,
    },
    exclude: {
      labels: repoConfig.exclude?.labels ?? DEFAULT_CONFIG.exclude.labels,
      users: repoConfig.exclude?.users ?? DEFAULT_CONFIG.exclude.users,
    },
    llm: {
      model: repoConfig.llm?.model ?? DEFAULT_CONFIG.llm.model,
      maxTokens: repoConfig.llm?.max_tokens ?? DEFAULT_CONFIG.llm.maxTokens,
    },
  };
}
