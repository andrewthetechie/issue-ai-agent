import type { LLMMessage, LLMResponse } from "./types.js";

export interface LLMProvider {
  complete(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    maxTokens?: number,
  ): Promise<LLMResponse>;
}
