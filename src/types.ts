export interface Issue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string };
  labels: Array<{ name: string; id: number }>;
  created_at: string;
}

export type IssueCategory =
  | "bug"
  | "feature"
  | "question"
  | "docs"
  | "duplicate"
  | "invalid"
  | "security";

export type IssuePriority = "critical" | "high" | "medium" | "low";

export interface RelatedIssue {
  number: number;
  title: string;
  url: string;
}

export interface IssueClassification {
  category: IssueCategory;
  priority: IssuePriority;
  confidence: number;
  summary: string;
  suggestedLabels: string[];
  reasoning: string;
  relatedIssues?: RelatedIssue[];
}

export type PromptConfigEntry = string | { file: string };
export type PromptKey = "classify" | "reply" | "duplicate" | "commentReply";

export interface RawPromptsConfig {
  classify?: PromptConfigEntry;
  reply?: PromptConfigEntry;
  duplicate?: PromptConfigEntry;
  commentReply?: PromptConfigEntry;
}

export interface RepoConfig {
  enabled: boolean;
  createLabels: boolean;
  features: {
    classify: boolean;
    reply: boolean;
    duplicateSearch: boolean;
    commentReply: boolean;
  };
  labelMapping: Record<string, string[]>;
  priorityLabelMapping: Record<string, string[]>;
  security: {
    maxIssueLength: number;
  };
  exclude: {
    labels: string[];
    users: string[];
  };
  batch: {
    triageLabel: string;
    batchLimit: number;
  };
  llm: {
    provider: "anthropic" | "openai";
    model: string;
    maxTokens: number;
  };
  prompts?: Partial<Record<PromptKey, string>>;
}

export interface PipelineResult {
  classification: IssueClassification | null;
  labelsApplied: string[];
  replyPosted: boolean;
  errors: PipelineError[];
}

export interface PipelineError {
  step: "classify" | "label" | "reply" | "duplicate" | "createLabels";
  message: string;
  cause?: Error;
}

export interface Logger {
  info(msgOrObj: unknown, msg?: string): void;
  warn(msgOrObj: unknown, msg?: string): void;
  error(msgOrObj: unknown, msg?: string): void;
  debug(msgOrObj: unknown, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

// Token is threaded explicitly to avoid latent credential leaks if ActionContext is ever logged.
export interface ActionContext {
  owner: string;
  repo: string;
  botLogin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any;
  logger: Logger;
  configPath?: string;
  eventName: "issues" | "issue_comment";
  payload: {
    action: string;
    issue: {
      number: number;
      title: string;
      body: string | null;
      html_url: string;
      user?: { login: string };
      labels?: Array<{ name: string; id: number }>;
      created_at: string;
      pull_request?: unknown;
    };
    comment?: {
      id: number;
      body: string | null;
      html_url: string;
      user?: { login: string };
      created_at: string;
    };
    sender?: { login: string };
    repository: {
      name: string;
      owner: { login: string };
      default_branch: string;
    };
    [key: string]: unknown;
  };
}
