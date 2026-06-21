import type { RepoConfig } from "../types.js";

export const DEFAULT_CONFIG: RepoConfig = {
  enabled: true,
  createLabels: false,
  features: {
    classify: true,
    reply: true,
    duplicateSearch: true,
    commentReply: true,
  },
  labelMapping: {
    bug: ["bug"],
    feature: ["enhancement"],
    question: ["question"],
    docs: ["documentation"],
    duplicate: ["duplicate"],
    invalid: ["invalid"],
    security: ["security"],
  },
  priorityLabelMapping: {
    critical: ["priority: critical"],
    high: ["priority: high"],
    medium: ["priority: medium"],
    low: ["priority: low"],
  },
  security: {
    maxIssueLength: 10000,
  },
  exclude: {
    labels: ["wontfix", "skip-ai"],
    users: ["dependabot[bot]"],
  },
  llm: {
    provider: "anthropic" as const,
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
  },
};
