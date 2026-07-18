import { describe, expect, it } from "vitest";
import {
  ApprovalError,
  canonicalJson,
  createPendingAction,
  verifyApproval
} from "../lib/security/approval";

const expected = { stateVersion: 7, sourceVersion: 1, planVersion: 0 };

describe("approval receipts", () => {
  it("canonicalizes nested arguments independent of key order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 })
    );
  });

  it("binds approval to actor, arguments, and expected versions", async () => {
    const created = await createPendingAction({
      sessionId: "session_1",
      actor: "student_emily",
      actionType: "save_personal_plan",
      args: { proposalId: "proposal_1", durationMinutes: 15 },
      expected,
      nowMs: 1_000,
      nonce: "fixed-test-nonce"
    });
    await expect(
      verifyApproval({
        pending: created.pending,
        receipt: created.receipt,
        args: { durationMinutes: 15, proposalId: "proposal_1" },
        expected,
        nowMs: 2_000
      })
    ).resolves.toMatchObject({ idempotencyKey: created.pending.idempotencyKey });
  });

  it("fails closed when arguments change", async () => {
    const created = await createPendingAction({
      sessionId: "session_1",
      actor: "student_emily",
      actionType: "save_personal_plan",
      args: { durationMinutes: 15 },
      expected,
      nowMs: 1_000,
      nonce: "fixed-test-nonce"
    });
    await expect(
      verifyApproval({
        pending: created.pending,
        receipt: created.receipt,
        args: { durationMinutes: 20 },
        expected,
        nowMs: 2_000
      })
    ).rejects.toMatchObject({ code: "ARGUMENT_MISMATCH" } satisfies Partial<ApprovalError>);
  });

  it("fails closed when approval expires", async () => {
    const created = await createPendingAction({
      sessionId: "session_1",
      actor: "student_emily",
      actionType: "save_personal_plan",
      args: { durationMinutes: 15 },
      expected,
      nowMs: 1_000,
      ttlMs: 500,
      nonce: "fixed-test-nonce"
    });
    await expect(
      verifyApproval({
        pending: created.pending,
        receipt: created.receipt,
        args: { durationMinutes: 15 },
        expected,
        nowMs: 2_000
      })
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" } satisfies Partial<ApprovalError>);
  });
});
