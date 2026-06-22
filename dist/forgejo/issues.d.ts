import type { Issue } from "../types.js";
export declare function fetchIssuesByLabel(serverUrl: string, owner: string, repo: string, triageLabel: string, batchLimit: number, token: string): Promise<Issue[]>;
