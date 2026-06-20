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

export interface RepoConfig {
  enabled: boolean;
  features: {
    classify: boolean;
    reply: boolean;
    duplicateSearch: boolean;
    commentReply: boolean;
  };
  labelMapping: Record<string, string[]>;
  security: {
    maxIssueLength: number;
  };
  exclude: {
    labels: string[];
    users: string[];
  };
  llm: {
    provider: "anthropic" | "openai";
    model: string;
    maxTokens: number;
  };
}

export interface PipelineResult {
  classification: IssueClassification | null;
  labelsApplied: string[];
  replyPosted: boolean;
  errors: PipelineError[];
}

export interface PipelineError {
  step: "classify" | "label" | "reply" | "duplicate";
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

// DESIGN DECISION: The token is intentionally NOT stored on ActionContext.
// ActionContext is shared across all modules (pipeline, comment handler, etc.)
// and could be logged, serialized, or debug-dumped. Storing the credential
// there creates a latent leak risk. Instead, the token and serverUrl are
// threaded explicitly to the one module that needs them (searchSimilarIssues
// via runPipeline). This keeps the credential encapsulated and auditable.
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
      user?: { login: string; type?: string };
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
    sender?: { login: string; type?: string };
    repository: {
      name: string;
      owner: { login: string };
      default_branch: string;
    };
    [key: string]: unknown;
  };
}
