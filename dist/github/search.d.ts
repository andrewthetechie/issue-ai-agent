import type { RelatedIssue } from "../types.js";
export declare function searchSimilarIssues(owner: string, repo: string, title: string, issueNumber: number, octokit: any): Promise<RelatedIssue[]>;
export declare const STOP_WORDS: Set<string>;
export declare function buildSearchQuery(title: string, owner: string, repo: string): string;
