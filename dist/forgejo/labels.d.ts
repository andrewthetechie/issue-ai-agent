import type { IssueClassification, Logger, RepoConfig } from "../types.js";
export declare function resolveLabels(classification: IssueClassification, config: RepoConfig): string[];
export declare function applyLabels(owner: string, repo: string, issueNumber: number, labels: string[], octokit: any, logger: Logger): Promise<string[]>;
/**
 * Ensures every label referenced by config.labelMapping / config.priorityLabelMapping
 * exists in the repo, creating only the missing ones. Idempotent and best-effort.
 *
 * Failure contract is intentionally asymmetric:
 *  - The existing-labels list call THROWS on failure; the caller (runPipeline) records
 *    a `createLabels` PipelineError and continues the rest of the pipeline.
 *  - Individual create failures are swallowed with a warning (one bad label never aborts
 *    the rest). A `422` whose message contains "already exists" is treated as a benign
 *    list/create race and swallowed silently.
 */
export declare function ensureLabelsExist(owner: string, repo: string, config: RepoConfig, octokit: any, logger: Logger): Promise<void>;
