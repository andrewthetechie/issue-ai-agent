import type { Logger } from "../types.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { LLMProvider } from "./provider.js";
export declare class AnthropicProvider implements LLMProvider {
    private client;
    private logger;
    constructor(apiKey: string, logger: Logger);
    complete(model: string, systemPrompt: string, messages: LLMMessage[], maxTokens?: number): Promise<LLMResponse>;
}
