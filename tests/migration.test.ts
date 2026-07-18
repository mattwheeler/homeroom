import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("D1 foundation migration", () => {
  it("creates the authoritative tables and idempotency constraints", async () => {
    const sql = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
    for (const table of [
      "demo_sessions",
      "plan_versions",
      "pending_actions",
      "practice_results",
      "guardian_projections",
      "audit_events",
      "ai_turns"
    ]) {
      expect(sql).toContain("CREATE TABLE " + table);
    }
    expect(sql).toContain("idempotency_key TEXT NOT NULL UNIQUE");
    expect(sql).not.toMatch(/SELECT.+\$\{/s);
  });

  it("adds a persistent guardian inbox for independent Family actions", async () => {
    const sql = await readFile(new URL("../migrations/0002_guardian_notifications.sql", import.meta.url), "utf8");
    expect(sql).toContain("CREATE TABLE guardian_notifications");
    expect(sql).toContain("UNIQUE (session_id, notification_type, task_record_id)");
    expect(sql).not.toMatch(/SELECT.+\$\{/s);
  });

  it("adds temporary Learning dialogue and durable evidence-backed learner context", async () => {
    const sql = await readFile(new URL("../migrations/0003_learning_continuity.sql", import.meta.url), "utf8");
    expect(sql).toContain("CREATE TABLE learning_sessions");
    expect(sql).toContain("CREATE TABLE learner_signals");
    expect(sql).toContain("CREATE TABLE learning_progress");
    expect(sql).toContain("CREATE TABLE learner_memory_events");
    expect(sql).toContain("context_json TEXT NOT NULL");
    expect(sql).not.toMatch(/SELECT.+\$\{/s);
  });

  it("adds encrypted read-only source connections and normalized source records", async () => {
    const sql = await readFile(new URL("../migrations/0004_readonly_source_connections.sql", import.meta.url), "utf8");
    for (const table of [
      "source_oauth_states",
      "source_connections",
      "source_courses",
      "source_coursework",
      "source_calendar_events"
    ]) {
      expect(sql).toContain("CREATE TABLE " + table);
    }
    expect(sql).toContain("secret_ciphertext TEXT NOT NULL");
    expect(sql).toContain("UNIQUE (student_id, provider)");
    expect(sql).not.toContain("access_token TEXT");
    expect(sql).not.toContain("refresh_token TEXT");
    expect(sql).not.toContain("calendar_url TEXT");
    expect(sql).not.toMatch(/SELECT.+\$\{/s);
  });
});
