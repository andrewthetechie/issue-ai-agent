import type { Logger } from "./types.js";
import type { Issue, RelatedIssue, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
export interface DuplicateResponse {
    duplicates: number[];
    reasoning: string;
}
export declare function parseDuplicateResponse(raw: string): DuplicateResponse;
export declare function detectDuplicates(issue: Issue, candidates: RelatedIssue[], llmClient: LLMProvider, config: RepoConfig, log: Logger): Promise<RelatedIssue[]>;
