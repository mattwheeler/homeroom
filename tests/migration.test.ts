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
});
