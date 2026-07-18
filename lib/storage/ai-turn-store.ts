import type { D1DatabaseLike } from "./session-store";

export interface AiTurnRecord {
  id: string;
  sessionId: string;
  stage: string;
  model: string;
  status: "completed" | "failed";
  responseIds: string[];
  toolTrace: Array<{ name: string; callId: string }>;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  errorCode: string | null;
  createdAt: string;
}

export interface AiTurnStore {
  record(record: AiTurnRecord): Promise<void>;
}

export class AiTurnStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTurnStoreError";
  }
}

export class D1AiTurnStore implements AiTurnStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async record(record: AiTurnRecord): Promise<void> {
    const result = await this.database
      .prepare(
        `INSERT INTO ai_turns (
          id, session_id, stage, model, status, openai_response_ids_json,
          tool_trace_json, latency_ms, input_tokens, output_tokens, cached_tokens,
          error_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.id,
        record.sessionId,
        record.stage,
        record.model,
        record.status,
        JSON.stringify(record.responseIds),
        JSON.stringify(record.toolTrace),
        record.latencyMs,
        record.inputTokens,
        record.outputTokens,
        record.cachedTokens,
        record.errorCode,
        record.createdAt
      )
      .run();
    if (!result.success) throw new AiTurnStoreError("Unable to persist the AI turn trace.");
  }
}
