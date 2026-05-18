export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}
