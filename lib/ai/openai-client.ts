import type { ModelResponse, ResponsesClient } from "./responses-loop";

interface OpenAIResponsesPayload {
  id?: unknown;
  model?: unknown;
  output?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
  };
  error?: { message?: unknown };
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Uses the Responses HTTP API directly. Keeping the Worker transport this small
 * avoids loading the full Node SDK on every AI request, which is material on the
 * Cloudflare CPU budget while preserving the same server-authoritative loop.
 */
export function createOpenAIResponsesClient(
  apiKey: string,
  fetcher: typeof fetch = fetch
): ResponsesClient {
  return {
    async create(payload: Record<string, unknown>): Promise<ModelResponse> {
      const response = await fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => null) as OpenAIResponsesPayload | null;
      if (!response.ok) {
        const providerMessage = typeof body?.error?.message === "string" ? body.error.message : "request rejected";
        throw new Error(`OpenAI Responses API ${response.status}: ${providerMessage}`);
      }
      if (
        !body ||
        typeof body.id !== "string" ||
        typeof body.model !== "string" ||
        !Array.isArray(body.output)
      ) {
        throw new Error("OpenAI Responses API returned an invalid response.");
      }
      return {
        id: body.id,
        model: body.model,
        output: body.output as Array<Record<string, unknown>>,
        usage: {
          inputTokens: integer(body.usage?.input_tokens),
          outputTokens: integer(body.usage?.output_tokens),
          cachedTokens: integer(body.usage?.input_tokens_details?.cached_tokens)
        }
      };
    }
  };
}
