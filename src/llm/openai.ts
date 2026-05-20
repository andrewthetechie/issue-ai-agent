import OpenAI from "openai";
import type { Logger } from "../types.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { LLMProvider } from "./provider.js";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private logger: Logger;

  constructor(apiKey: string, logger: Logger, baseURL?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.logger = logger.child({ module: "llm" });
  }

  async complete(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    maxTokens: number = 2048,
  ): Promise<LLMResponse> {
    try {
      this.logger.debug({ model, messageCount: messages.length }, "Sending request to OpenAI");

      const response = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
      });

      const text = response.choices[0]?.message?.content;
      if (!text) {
        throw new Error("No text content in OpenAI response");
      }

      this.logger.info(
        {
          model,
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        "OpenAI response received",
      );

      return {
        text,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      this.logger.error({ err: error, model }, "OpenAI API call failed");
      throw error;
    }
  }
}
