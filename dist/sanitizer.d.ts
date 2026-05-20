import type { RepoConfig } from "./types.js";
export declare function sanitizeIssueBody(body: string | null, config: RepoConfig): string;
export declare function sanitizeIssueTitle(title: string): string;
export declare function buildSafeIssueContent(title: string, sanitizedBody: string, existingLabels: string[]): string;
