import type { RepoConfig } from "./types.js";
export declare function shouldExclude(issue: {
    user?: {
        login: string;
    };
    labels: Array<{
        name: string;
    }>;
}, config: RepoConfig): boolean;
