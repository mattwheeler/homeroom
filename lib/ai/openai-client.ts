import OpenAI from "openai";

import type { ModelResponse, ResponsesClient } from "./responses-loop";

export function createOpenAIResponsesClient(apiKey: string): ResponsesClient {
  const openai = new OpenAI({ apiKey });
  return {
    async create(payload: Record<string, unknown>): Promise<ModelResponse> {
      const response = await openai.responses.create(payload as never);
      return {
        id: response.id,
        model: response.model,
        output: response.output as unknown as Array<Record<string, unknown>>,
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              cachedTokens: response.usage.input_tokens_details?.cached_tokens ?? 0
            }
          : undefined
      };
    }
  };
}
