import { describe, expect, it } from "vitest";

import { ClientResponseError, readJsonResponse } from "../lib/http/client-json";

describe("readJsonResponse", () => {
  it("returns a typed JSON payload", async () => {
    const response = Response.json({ ok: true }, { status: 200 });

    await expect(readJsonResponse<{ ok: boolean }>(response, "Could not load.")).resolves.toEqual({ ok: true });
  });

  it("turns a Cloudflare HTML response into a safe retryable error without exposing markup", async () => {
    const response = new Response("<!DOCTYPE html><title>Error 1102</title>", {
      status: 500,
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cf-ray": "ray-student-refresh"
      }
    });

    const error = await readJsonResponse(response, "Your school day could not be refreshed yet.")
      .then(() => null, (caught) => caught);

    expect(error).toBeInstanceOf(ClientResponseError);
    expect(error).toMatchObject({
      message: "Your school day could not be refreshed yet.",
      status: 500,
      rayId: "ray-student-refresh",
      retryable: true
    });
    expect(String(error)).not.toContain("DOCTYPE");
  });

  it("turns malformed JSON into a safe response error", async () => {
    const response = new Response("{not-json", {
      status: 502,
      headers: { "content-type": "application/json" }
    });

    await expect(readJsonResponse(response, "Try again.")).rejects.toMatchObject({
      message: "Try again.",
      status: 502,
      retryable: true
    });
  });
});
