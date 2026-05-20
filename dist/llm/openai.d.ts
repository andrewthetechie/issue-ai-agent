import type { Logger } from "../types.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { LLMProvider } from "./provider.js";
export declare class OpenAIProvider implements LLMProvider {
    private client;
    private logger;
    constructor(apiKey: string, logger: Logger, baseURL?: string);
    complete(model: string, systemPrompt: string, messages: LLMMessage[], maxTokens?: number): Promise<LLMResponse>;
}
