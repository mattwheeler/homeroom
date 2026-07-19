import { describe, expect, it, vi } from "vitest";

import {
  generatePlanRevision,
  planRevisionSchema
} from "../lib/ai/plan-revision";
import type { MorningPlan } from "../lib/ai/morning-plan";
import type { AiTurnRecord, AiTurnStore } from "../lib/storage/ai-turn-store";
import type { SessionRecord } from "../lib/storage/session-store";

const currentPlan: MorningPlan = {
  title: "Your band-camp morning",
  intro: "A calm start.",
  steps: [
    { time: "06:30", title: "Wake up", detail: "Get ready.", sourceLabel: "Homeroom" },
    { time: "06:45", title: "Bag check", detail: "Check your bag.", sourceLabel: "Packing list" },
    { time: "07:00", title: "Leave", detail: "Leave home.", sourceLabel: "BAND calendar" },
    { time: "07:30", title: "Check in", detail: "Check in.", sourceLabel: "BAND calendar" }
  ],
  guardianNote: "Matt owns the physical form.",
  encouragement: "You are ready.",
  approvalPrompt: "Save this plan?"
};

const revision = planRevisionSchema.parse({
  change: {
    title: "Your BAND check-in moved 15 minutes earlier",
    summary: "Check-in changed from 7:30 AM to 7:15 AM, so the morning steps move 15 minutes earlier.",
    changedField: "checkIn",
    before: "07:30",
    after: "07:15",
    minutesEarlier: 15,
    sourceLabel: "BAND calendar · event_band_camp_day_1"
  },
  plan: {
    title: "Updated band-camp morning",
    intro: "The same calm routine, shifted 15 minutes earlier.",
    steps: [
      { time: "06:15", title: "Wake up", detail: "Get dressed and have breakfast.", sourceLabel: "Homeroom plan" },
      { time: "06:30", title: "Final bag check", detail: "Bring your instrument, water, and music folder.", sourceLabel: "Band packing list" },
      { time: "06:45", title: "Leave home", detail: "Allow 20 minutes for travel and a 10-minute buffer.", sourceLabel: "BAND calendar + preferences" },
      { time: "07:15", title: "Check in", detail: "You will be ready before the 8:00 AM start.", sourceLabel: "BAND calendar" }
    ],
    guardianNote: "Matt still owns the band physical form due July 24.",
    encouragement: "The schedule changed, but your plan is already catching up.",
    approvalPrompt: "Review the updated times before saving Plan V2."
  }
});

const session: SessionRecord = {
  id: "session_01",
  fixtureKey: "emily_band_camp_v1",
  actorId: "student_emily",
  role: "student",
  state: { phase: "SOURCE_V2_SYNCED", stateVersion: 8, sourceVersion: 2, activePlanVersion: 1 },
  csrfHash: "hash",
  expiresAt: "2026-07-18T14:00:00.000Z",
  createdAt: "2026-07-18T12:00:00.000Z",
  updatedAt: "2026-07-18T12:07:00.000Z"
};

class CapturingAiTurnStore implements AiTurnStore {
  records: AiTurnRecord[] = [];
  async record(record: AiTurnRecord) { this.records.push(record); }
}

describe("live Plan V2 revision generation", () => {
  it("uses one read-only revision-context tool and returns an exact source-grounded diff", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "resp_revision_context",
        model: "gpt-5.6-sol-2026-07-15",
        output: [{
          type: "function_call",
          call_id: "call_revision_context",
          name: "get_plan_revision_context",
          arguments: JSON.stringify({ sessionId: "session_01", studentId: "student_emily" })
        }],
        usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 10 }
      })
      .mockResolvedValueOnce({
        id: "resp_revision",
        model: "gpt-5.6-sol-2026-07-15",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(revision) }] }],
        usage: { inputTokens: 180, outputTokens: 160, cachedTokens: 40 }
      });
    const traceStore = new CapturingAiTurnStore();

    const result = await generatePlanRevision({
      session,
      currentPlan,
      client: { create },
      traceStore,
      now: () => new Date("2026-07-18T12:08:00.000Z"),
      randomUUID: () => "turn_revision_01"
    });

    expect(result.revision).toEqual(revision);
    expect(result.proof).toEqual({
      model: "gpt-5.6-sol-2026-07-15",
      responseIds: ["resp_revision_context", "resp_revision"],
      tools: ["get_plan_revision_context"],
      sourceVersion: 2,
      previousPlanVersion: 1
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      reasoning: { effort: "low", context: "current_turn" },
      tools: [{ name: "get_plan_revision_context", strict: true }],
      text: { format: { type: "json_schema", name: "plan_revision", strict: true } }
    });
    expect(create.mock.calls[1][0].input).toContainEqual(expect.objectContaining({
      type: "function_call_output",
      call_id: "call_revision_context",
      output: expect.stringContaining('"checkIn":"07:15"')
    }));
    expect(create.mock.calls[1][0].input).toContainEqual(expect.objectContaining({
      output: expect.stringContaining('"time":"07:30"')
    }));
    expect(create.mock.calls[1][0].input).toContainEqual(expect.objectContaining({
      output: expect.stringContaining('"developmentalStage":"early_high_school"')
    }));
    expect(create.mock.calls[1][0].input).toContainEqual(expect.objectContaining({
      output: expect.stringContaining('"worked_example_or_organizer"')
    }));
    expect(traceStore.records).toEqual([
      expect.objectContaining({
        id: "turn_revision_01",
        sessionId: "session_01",
        stage: "plan_revision",
        status: "completed",
        responseIds: ["resp_revision_context", "resp_revision"],
        toolTrace: [{ name: "get_plan_revision_context", callId: "call_revision_context" }]
      })
    ]);
  });

  it("fails closed when the revision keeps an old source-derived time", async () => {
    const invalid = {
      ...revision,
      plan: {
        ...revision.plan,
        steps: revision.plan.steps.map((step, index) => index === 3 ? { ...step, time: "07:30" } : step)
      }
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "resp_context",
        model: "gpt-5.6-sol",
        output: [{
          type: "function_call", call_id: "call_context", name: "get_plan_revision_context",
          arguments: JSON.stringify({ sessionId: "session_01", studentId: "student_emily" })
        }]
      })
      .mockResolvedValueOnce({
        id: "resp_invalid", model: "gpt-5.6-sol",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(invalid) }] }]
      });

    await expect(generatePlanRevision({
      session,
      currentPlan,
      client: { create },
      traceStore: new CapturingAiTurnStore()
    })).rejects.toThrow(/source times/i);
  });
});
