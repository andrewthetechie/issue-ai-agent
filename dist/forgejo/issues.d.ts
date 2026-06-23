import type { Issue } from "../types.js";
export declare function fetchIssuesByLabel(serverUrl: string, owner: string, repo: string, triageLabel: string, batchLimit: number, token: string): Promise<Issue[]>;
/**
 * Removes a label from an issue by label id via the Forgejo API.
 *
 * Endpoint: DELETE /api/v1/repos/{owner}/{repo}/issues/{issueIndex}/labels/{labelId}
 *
 * A 404 response (label not present on the issue) is treated as success
 * because the desired end state is "label absent".
 */
export declare function removeLabelFromIssue(serverUrl: string, owner: string, repo: string, issueIndex: number, labelId: number, token: string): Promise<void>;
