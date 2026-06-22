import type { RelatedIssue } from "../types.js";
export declare function postDuplicateComment(octokit: any, owner: string, repo: string, issueNumber: number, duplicates: RelatedIssue[]): Promise<void>;
export declare function postExcludeRemovalComment(octokit: any, owner: string, repo: string, issueNumber: number, triageLabel: string, reason: "user" | "label"): Promise<void>;
