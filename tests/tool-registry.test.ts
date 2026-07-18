import { describe, expect, it } from "vitest";
import { getStageTools, validateToolArguments } from "../lib/ai/tool-registry";

describe("stage-scoped function tools", () => {
  it("exposes one read-only context tool for the live morning-plan slice", () => {
    const tools = getStageTools("morning_plan");
    expect(tools.map((tool) => tool.name)).toEqual(["get_morning_plan_context"]);
    expect(tools[0]).toMatchObject({
      strict: true,
      parameters: {
        required: ["sessionId", "studentId"],
        additionalProperties: false
      }
    });
  });

  it("exposes only orientation reads during orientation", () => {
    const names = getStageTools("orientation").map((tool) => tool.name);
    expect(names).toEqual([
      "list_courses",
      "list_upcoming_events",
      "list_guardian_actions",
      "list_readiness_activities"
    ]);
    expect(names).not.toContain("save_personal_plan");
  });

  it("uses strict closed schemas for every tool", () => {
    for (const tool of getStageTools("plan_gathering")) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.required).toEqual(Object.keys(tool.parameters.properties));
    }
  });

  it("rejects a later-stage tool before execution", () => {
    expect(() =>
      validateToolArguments("orientation", "save_personal_plan", {
        sessionId: "session_1"
      })
    ).toThrow(/not allowed/i);
  });

  it("rejects additional arguments", () => {
    expect(() =>
      validateToolArguments("orientation", "list_courses", {
        sessionId: "session_1",
        studentId: "student_emily",
        includeGrades: true
      })
    ).toThrow();
  });
});
