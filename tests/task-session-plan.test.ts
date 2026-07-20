import { describe, expect, it } from "vitest";

import {
  buildTaskSessionPlan,
  classifyTaskSessionKind
} from "../lib/domain/task-session-plan";

describe("task-specific focus-session plans", () => {
  it.each([10, 15, 20, 30])(
    "uses the entire %i-minute timebox without inventing extra time",
    (selectedMinutes) => {
      const plan = buildTaskSessionPlan({
        externalId: "spanish_vocab_01",
        title: "Classroom Words Picture Match",
        directions: "Match ten classroom vocabulary words to the correct picture.",
        taskKind: "vocabulary",
        selectedMinutes,
        maxSteps: 4
      });

      expect(plan.steps.reduce((sum, step) => sum + step.minutes, 0)).toBe(selectedMinutes);
      expect(plan.steps.length).toBeGreaterThanOrEqual(2);
      expect(plan.steps.length).toBeLessThanOrEqual(4);
      expect(plan.steps.map((step) => step.id)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("spanish_vocab_01:vocabulary:")
        ])
      );
    }
  );

  it("creates different, useful actions for vocabulary, math, and preparation tasks", () => {
    const vocabulary = buildTaskSessionPlan({
      externalId: "vocab",
      title: "Classroom Words Picture Match",
      directions: "Match vocabulary words to pictures.",
      selectedMinutes: 20,
      maxSteps: 4
    });
    const math = buildTaskSessionPlan({
      externalId: "math",
      title: "Balancing Equations Readiness Check",
      directions: "Complete problems 1-5 and explain why both sides stay balanced.",
      selectedMinutes: 20,
      maxSteps: 4
    });
    const packing = buildTaskSessionPlan({
      externalId: "packing",
      title: "Band Camp Packing Checklist",
      directions: "Confirm your instrument, music binder, water bottle, sunscreen, hat, lunch, and athletic shoes are ready.",
      selectedMinutes: 20,
      maxSteps: 4
    });

    expect(vocabulary.kind).toBe("vocabulary");
    expect(vocabulary.steps.map((step) => step.label).join(" ")).toMatch(/words|match|check/i);
    expect(math.kind).toBe("math_problem_set");
    expect(math.steps.map((step) => step.action).join(" ")).toMatch(/problem|equation|work/i);
    expect(packing.kind).toBe("checklist_preparation");
    expect(packing.steps.map((step) => step.action).join(" ")).toMatch(/list|ready|missing/i);
    expect(vocabulary.steps.map((step) => step.label)).not.toEqual(math.steps.map((step) => step.label));
    expect(math.steps.map((step) => step.label)).not.toEqual(packing.steps.map((step) => step.label));
  });

  it("keeps step identities stable when Emily changes the timebox", () => {
    const base = {
      externalId: "reading_01",
      title: "Summer Reading Reflection",
      directions: "Read the passage and write one paragraph using evidence.",
      maxSteps: 4 as const
    };
    const short = buildTaskSessionPlan({ ...base, selectedMinutes: 10 });
    const long = buildTaskSessionPlan({ ...base, selectedMinutes: 20 });

    expect(short.kind).toBe("writing");
    expect(short.steps.map((step) => step.id)).toEqual(long.steps.map((step) => step.id));
    expect(short.steps.map((step) => step.minutes)).not.toEqual(long.steps.map((step) => step.minutes));
  });

  it("classifies from source-backed task text rather than treating every task alike", () => {
    expect(classifyTaskSessionKind({ title: "Chapter 4 reading", directions: "Read pages 20-31." })).toBe("reading");
    expect(classifyTaskSessionKind({ title: "Concert excerpt practice", directions: "Rehearse measures 12-24." })).toBe("performance_practice");
    expect(classifyTaskSessionKind({ title: "Poster project", directions: "Research and create a visual poster." })).toBe("project_research");
  });

  it("reclassifies a stale generic hint when the source directions clearly identify the task", () => {
    const plan = buildTaskSessionPlan({
      externalId: "spanish_intro",
      title: "Introductions: Me llamo…",
      directions: "Write a four-line introduction using your name, age, one interest, and a greeting.",
      taskKind: "generic",
      selectedMinutes: 20,
      maxSteps: 4
    });

    expect(plan.kind).toBe("writing");
    expect(plan.steps.map((step) => step.label).join(" ")).toMatch(/plan|draft|revise/i);
  });
});
