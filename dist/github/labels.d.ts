import type { IssueClassification, Logger, RepoConfig } from "../types.js";
export declare function resolveLabels(classification: IssueClassification, config: RepoConfig): string[];
export declare function applyLabels(owner: string, repo: string, issueNumber: number, labels: string[], octokit: any, logger: Logger): Promise<string[]>;
