import { describe, expect, it, vi } from "vitest";

import { createOpenAIResponsesClient } from "../lib/ai/openai-client";

describe("OpenAI Responses HTTP client", () => {
  it("sends the exact server payload and normalizes the response", async () => {
    const fetcher = vi.fn(async () => Response.json({
      id: "resp_01",
      model: "gpt-5.6-sol",
      output: [{ type: "message", content: [] }],
      usage: { input_tokens: 12, output_tokens: 4, input_tokens_details: { cached_tokens: 2 } }
    }));
    const client = createOpenAIResponsesClient("secret-key", fetcher);

    await expect(client.create({ model: "gpt-5.6-sol", store: false })).resolves.toEqual({
      id: "resp_01",
      model: "gpt-5.6-sol",
      output: [{ type: "message", content: [] }],
      usage: { inputTokens: 12, outputTokens: 4, cachedTokens: 2 }
    });
    expect(fetcher).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer secret-key" }),
      body: JSON.stringify({ model: "gpt-5.6-sol", store: false })
    }));
  });

  it("fails closed on provider errors and malformed success bodies", async () => {
    const rejected = createOpenAIResponsesClient("key", async () =>
      Response.json({ error: { message: "bad request" } }, { status: 400 })
    );
    await expect(rejected.create({})).rejects.toThrow(/400: bad request/);

    const malformed = createOpenAIResponsesClient("key", async () => Response.json({ id: "resp_01" }));
    await expect(malformed.create({})).rejects.toThrow(/invalid response/);
  });
});
