import type { Logger } from "./types.js";
import type { Issue, IssueClassification, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
export declare function parseClassificationResponse(raw: string): IssueClassification;
export declare function classifyIssue(issue: Issue, sanitizedBody: string, sanitizedTitle: string, config: RepoConfig, llmClient: LLMProvider, logger: Logger): Promise<IssueClassification>;
