import { describe, expect, it } from "vitest";

import { D1AiTurnStore, type AiTurnRecord } from "../lib/storage/ai-turn-store";
import type { D1DatabaseLike } from "../lib/storage/session-store";

const record: AiTurnRecord = {
  id: "turn_01",
  sessionId: "session_01",
  stage: "morning_plan",
  model: "gpt-5.6-sol",
  status: "completed",
  responseIds: ["resp_1", "resp_2"],
  toolTrace: [{ name: "get_morning_plan_context", callId: "call_1" }],
  latencyMs: 250,
  inputTokens: 120,
  outputTokens: 80,
  cachedTokens: 20,
  errorCode: null,
  createdAt: "2026-07-18T12:05:00.000Z"
};

describe("D1 AI turn store", () => {
  it("persists trace fields through bound parameters", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const database: D1DatabaseLike = {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values });
            return { async run() { return { success: true }; }, async first<T>() { return null as T | null; } };
          }
        };
      }
    };
    await new D1AiTurnStore(database).record(record);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("INSERT INTO ai_turns");
    expect(calls[0]?.sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    expect(calls[0]?.values).toContain(JSON.stringify(record.responseIds));
    expect(calls[0]?.values).toContain(JSON.stringify(record.toolTrace));
  });

  it("fails closed when D1 rejects the trace write", async () => {
    const database: D1DatabaseLike = {
      prepare() {
        return {
          bind() {
            return { async run() { return { success: false }; }, async first<T>() { return null as T | null; } };
          }
        };
      }
    };
    await expect(new D1AiTurnStore(database).record(record)).rejects.toThrow("AI turn");
  });
});
