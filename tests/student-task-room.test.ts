import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  StudentTaskRoomContent,
  createTaskRoomState,
  taskRoomReducer
} from "../app/components/student-task-room";
import type { StudentSourceProjection } from "../lib/domain/student-source-projection";

type Priority = StudentSourceProjection["priorities"][number];

const packingPriority: Priority = {
  id: "priority:packing",
  rank: 1,
  priorityBand: "do_first",
  title: "Band Camp Packing Checklist",
  directions: "Use the director’s list to pack your instrument, water jug, drill book, sunscreen, and athletic shoes.",
  sourceLink: "https://classroom.google.com/c/concert_band/a/packing",
  course: {
    externalId: "concert_band",
    name: "Concert Band - Period 6",
    trackCourseId: "course_band"
  },
  due: { date: "2026-07-31", time: "23:59:00" },
  urgency: {
    level: "soon",
    label: "Due in 3 days",
    visualToken: "amber",
    daysUntilDue: 3
  },
  effort: {
    level: "medium",
    label: "20-minute focus task",
    estimatedMinutes: 20,
    recommendedTimeboxMinutes: 15
  },
  rationale: {
    summary: "Pack the required items before camp so the morning stays calm.",
    signals: ["Due in 3 days", "About 20 minutes", "Not submitted"]
  },
  chunks: [
    {
      id: "packing:setup",
      order: 1,
      label: "Gather",
      action: "Put your instrument, water jug, and drill book in one place.",
      minutes: 4,
      skill: "organization",
      visualState: "ready"
    },
    {
      id: "packing:focus",
      order: 2,
      label: "Check",
      action: "Compare each item with the director's checklist.",
      minutes: 8,
      skill: "time_management",
      visualState: "next"
    },
    {
      id: "packing:finish",
      order: 3,
      label: "Place by the door",
      action: "Choose what must be ready tonight and stage the bag.",
      minutes: 3,
      skill: "prioritization",
      visualState: "check"
    }
  ],
  source: {
    provider: "google_classroom",
    recordType: "coursework",
    externalId: "packing",
    sourceUpdatedAt: "2026-07-18T20:00:00.000Z"
  }
};

describe("StudentTaskRoom", () => {
  it("turns a live priority into an evidence-backed, three-step workroom", () => {
    const html = renderToStaticMarkup(createElement(StudentTaskRoomContent, {
      priority: packingPriority,
      onClose: vi.fn()
    }));

    expect(html).toContain("Band Camp Packing Checklist");
    expect(html).toContain("Concert Band - Period 6");
    expect(html).toContain("Due in 3 days");
    expect(html).toContain("Google Classroom");
    expect(html).toContain("Directions");
    expect(html).toContain("Use the director’s list to pack your instrument");
    expect(html).toContain("Open the original assignment");
    expect(html).toContain("Gather");
    expect(html).toContain("Compare each item with the director&#x27;s checklist.");
    expect(html).toContain("Place by the door");
    expect(html).toContain("0 of 3 chunks complete");
    expect(html).toContain("Homeroom never submits or changes this assignment");
    expect(html).toContain("Your focus will be saved so Homeroom can help you return without judgment.");
  });

  it("shows the course Learning room as a secondary action only when it can be opened", () => {
    const withLearning = renderToStaticMarkup(createElement(StudentTaskRoomContent, {
      priority: packingPriority,
      onClose: vi.fn(),
      onOpenLearning: vi.fn()
    }));
    const withoutLearning = renderToStaticMarkup(createElement(StudentTaskRoomContent, {
      priority: {
        ...packingPriority,
        course: { ...packingPriority.course, trackCourseId: null }
      },
      onClose: vi.fn(),
      onOpenLearning: vi.fn()
    }));

    expect(withLearning).toContain("Open a guided Learning session");
    expect(withoutLearning).not.toContain("Open a guided Learning session");
  });

  it("advances to the next visible chunk as work is checked off", () => {
    const chunkIds = packingPriority.chunks.map((chunk) => chunk.id);
    let state = createTaskRoomState(packingPriority);

    expect(state.selectedChunkId).toBe("packing:setup");
    state = taskRoomReducer(state, {
      type: "toggle_chunk",
      chunkId: "packing:setup",
      orderedChunkIds: chunkIds
    });
    expect(state.completedChunkIds).toEqual(["packing:setup"]);
    expect(state.selectedChunkId).toBe("packing:focus");

    state = taskRoomReducer(state, {
      type: "toggle_chunk",
      chunkId: "packing:setup",
      orderedChunkIds: chunkIds
    });
    expect(state.completedChunkIds).toEqual([]);
    expect(state.selectedChunkId).toBe("packing:setup");
  });

  it("supports choosing, starting, pausing, resuming, and safely expiring a timebox", () => {
    let state = createTaskRoomState(packingPriority);
    state = taskRoomReducer(state, { type: "set_timebox", minutes: 10 });
    expect(state.remainingSeconds).toBe(600);

    state = taskRoomReducer(state, { type: "start_timer" });
    expect(state.timerStatus).toBe("running");
    state = taskRoomReducer(state, { type: "tick" });
    expect(state.remainingSeconds).toBe(599);
    state = taskRoomReducer(state, { type: "pause_timer" });
    expect(state.timerStatus).toBe("paused");
    state = taskRoomReducer(state, { type: "start_timer" });
    expect(state.timerStatus).toBe("running");

    state = { ...state, remainingSeconds: 1 };
    state = taskRoomReducer(state, { type: "tick" });
    expect(state).toMatchObject({ remainingSeconds: 0, timerStatus: "elapsed" });
    state = taskRoomReducer(state, { type: "reset_timer" });
    expect(state).toMatchObject({ remainingSeconds: 600, timerStatus: "idle" });
  });
});
