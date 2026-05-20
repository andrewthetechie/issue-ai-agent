import type { Logger } from "../types.js";
import type { LLMProvider } from "./provider.js";
export type ProviderName = "anthropic" | "openai";
export declare function createProvider(provider: ProviderName, logger: Logger): LLMProvider | null;
export declare function detectProvider(): ProviderName;
