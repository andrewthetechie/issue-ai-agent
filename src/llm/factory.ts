import type { Logger } from "pino";
import type { LLMProvider } from "./provider.js";
import { AnthropicProvider } from "./client.js";
import { OpenAIProvider } from "./openai.js";

export type ProviderName = "anthropic" | "openai";

export function createProvider(
  provider: ProviderName,
  logger: Logger,
): LLMProvider | null {
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    return new OpenAIProvider(apiKey, logger);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new AnthropicProvider(apiKey, logger);
}

export function detectProvider(): ProviderName {
  if (process.env.OPENAI_API_KEY) return "openai";
  return "anthropic";
}
