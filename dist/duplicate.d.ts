import type { Logger } from "./types.js";
import type { GitHubIssue, RelatedIssue, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
export interface DuplicateResponse {
    duplicates: number[];
    reasoning: string;
}
export declare function parseDuplicateResponse(raw: string): DuplicateResponse;
export declare function detectDuplicates(issue: GitHubIssue, candidates: RelatedIssue[], llmClient: LLMProvider, config: RepoConfig, log: Logger): Promise<RelatedIssue[]>;
