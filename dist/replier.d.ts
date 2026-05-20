import type { Logger } from "./types.js";
import type { GitHubIssue, IssueClassification, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
export declare function draftReply(issue: GitHubIssue, classification: IssueClassification, sanitizedBody: string, sanitizedTitle: string, config: RepoConfig, llmClient: LLMProvider, logger: Logger): Promise<string>;
