import type { RelatedIssue } from "../types.js";
export declare const STOP_WORDS: Set<string>;
export declare function buildSearchKeywords(title: string): string;
export declare function searchSimilarIssues(owner: string, repo: string, title: string, issueNumber: number, serverUrl: string, token: string): Promise<RelatedIssue[]>;
