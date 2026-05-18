export interface GitHubIssue {
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

export interface IssueClassification {
  category: IssueCategory;
  priority: IssuePriority;
  confidence: number;
  summary: string;
  suggestedLabels: string[];
  reasoning: string;
}

export interface RepoConfig {
  enabled: boolean;
  features: {
    classify: boolean;
    reply: boolean;
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
  step: "classify" | "label" | "reply";
  message: string;
  cause?: Error;
}
