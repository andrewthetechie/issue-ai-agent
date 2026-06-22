import type { Logger, PromptKey, RawPromptsConfig } from "../types.js";
export declare function resolvePrompts(raw: RawPromptsConfig | undefined, owner: string, repo: string, octokit: any, logger: Logger): Promise<Partial<Record<PromptKey, string>> | undefined>;
