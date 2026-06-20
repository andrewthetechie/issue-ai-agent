import type { ActionContext, PipelineResult } from "./types.js";
export declare function runPipeline(actx: ActionContext, serverUrl: string, token: string): Promise<PipelineResult>;
