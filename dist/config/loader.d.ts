import type { RepoConfig } from "../types.js";
export declare function loadConfig(owner: string, repo: string, octokit: any, configPath?: string): Promise<RepoConfig>;
