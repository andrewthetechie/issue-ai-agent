import type { Logger, RepoConfig } from "../types.js";
export declare function loadConfig(owner: string, repo: string, octokit: any, logger: Logger, configPath?: string): Promise<RepoConfig>;
