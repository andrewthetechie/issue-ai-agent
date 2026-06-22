import type { ActionContext, BatchResult } from "./types.js";
export declare function runBatchPipeline(actx: ActionContext, serverUrl: string, token: string): Promise<BatchResult>;
