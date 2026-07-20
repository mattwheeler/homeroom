import { describe, expect, it } from "vitest";

import { buildReentry, completeFocusBlock } from "../lib/domain/focus-block";
import type { FocusBlockStore } from "../lib/storage/focus-block-store";

class MemoryFocusBlocks implements FocusBlockStore {
  rows: Awaited<ReturnType<FocusBlockStore["listRecent"]>> = [];
  async save(record: Parameters<FocusBlockStore["save"]>[0]) { this.rows.unshift(record); return record; }
  async listRecent(studentId: string) { return this.rows.filter((row) => row.studentId === studentId); }
}

describe("persistent focus blocks and shame-free re-entry", () => {
  it("stores the source-backed task, chosen timebox, chunks, and estimate versus actual", async () => {
    const store = new MemoryFocusBlocks();
    const result = await completeFocusBlock({
      store,
      studentId: "principal_student",
      sessionId: "session_01",
      task: {
        id: "priority:packing",
        title: "Band Camp Packing Checklist",
        courseName: "Concert Band - Period 6",
        sourceProvider: "google_classroom",
        sourceExternalId: "packing",
        estimatedMinutes: 20,
        validChunkIds: ["packing:setup", "packing:focus", "packing:finish"],
        plannedChunkCount: 3,
        taskKind: "checklist_preparation",
        sourceStatus: "Not submitted"
      },
      selectedMinutes: 15,
      elapsedSeconds: 712,
      completedChunkIds: ["packing:setup", "packing:focus", "packing:finish"],
      now: () => new Date("2026-07-19T16:00:00.000Z"),
      randomUUID: () => "focus_01"
    });
    expect(result).toMatchObject({
      id: "focus_01",
      estimatedMinutes: 20,
      selectedMinutes: 15,
      elapsedSeconds: 712,
      completedChunkCount: 3,
      plannedChunkCount: 3,
      taskKind: "checklist_preparation",
      sourceStatus: "Not submitted"
    });
  });

  it("offers a non-judgmental return after two quiet days", () => {
    const result = buildReentry({
      lastFocusAt: "2026-07-16T16:00:00.000Z",
      now: new Date("2026-07-19T16:00:00.000Z"),
      nextTaskTitle: "Summer Reading Reflection"
    });
    expect(result).toEqual({
      active: true,
      title: "Today is a new start.",
      message: "No catching up all at once. Let’s begin with Summer Reading Reflection.",
      missedDayCount: 2
    });
  });

  it("stays quiet for a first visit or a recent focus block and rejects invisible chunks", async () => {
    expect(buildReentry({ lastFocusAt: null, now: new Date(), nextTaskTitle: "Anything" })).toMatchObject({ active: false, missedDayCount: 0 });
    expect(buildReentry({
      lastFocusAt: "2026-07-18T16:00:00.000Z",
      now: new Date("2026-07-19T16:00:00.000Z"),
      nextTaskTitle: "Anything"
    })).toMatchObject({ active: false, missedDayCount: 0 });
    await expect(completeFocusBlock({
      store: new MemoryFocusBlocks(), studentId: "s", sessionId: "x",
      task: {
        id: "t", title: "Task", courseName: "Class", sourceProvider: "source",
        sourceExternalId: "e", estimatedMinutes: 0, validChunkIds: ["valid"],
        plannedChunkCount: 1, taskKind: "generic", sourceStatus: "Not submitted"
      },
      selectedMinutes: 99, elapsedSeconds: -2, completedChunkIds: ["invalid"]
    })).rejects.toThrow(/visible chunk/);
  });
});
