import yaml from "js-yaml";
import type { RepoConfig } from "../types.js";
import { DEFAULT_CONFIG } from "./schema.js";

export async function loadConfig(
  owner: string,
  repo: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  configPath: string = ".github/issue-ai.yml",
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

  return {
    enabled: repoConfig.enabled ?? DEFAULT_CONFIG.enabled,
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
    llm: {
      provider: repoConfig.llm?.provider ?? DEFAULT_CONFIG.llm.provider,
      model: repoConfig.llm?.model ?? DEFAULT_CONFIG.llm.model,
      maxTokens: repoConfig.llm?.max_tokens ?? DEFAULT_CONFIG.llm.maxTokens,
    },
  };
}
