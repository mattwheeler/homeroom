import { describe, expect, it } from "vitest";

import { buildLivePlanContext } from "../lib/domain/live-plan-context";
import { navigationProjection as studentProjectionFixture } from "./student-navigation-fixture";

describe("live planning context", () => {
  it("grounds the planner in the current normalized projection and hashes exact source evidence", async () => {
    const context = await buildLivePlanContext(studentProjectionFixture, new Date("2026-07-18T15:00:00.000Z"));
    expect(context.mode).toBe("live");
    expect(context.priorities[0]?.title).toBe(studentProjectionFixture.priorities[0]?.title);
    expect(context.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(context.policy).toMatchObject({ proposalOnly: true, requiresStudentApprovalToSave: true, sourceTextIsUntrusted: true });
  });
});
