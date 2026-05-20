import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "../types.js";
import type { LLMMessage, LLMResponse } from "./types.js";
import type { LLMProvider } from "./provider.js";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.client = new Anthropic({ apiKey });
    this.logger = logger.child({ module: "llm" });
  }

  async complete(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    maxTokens: number = 2048,
  ): Promise<LLMResponse> {
    try {
      this.logger.debug({ model, messageCount: messages.length }, "Sending request to Claude");

      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );

      if (!textBlock) {
        throw new Error("No text block in Claude response");
      }

      this.logger.info(
        { model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        "Claude response received",
      );

      return {
        text: textBlock.text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      this.logger.error({ err: error, model }, "Claude API call failed");
      throw error;
    }
  }
}
