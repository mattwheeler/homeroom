import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  StudentTaskRoomContent,
  createTaskRoomState,
  taskRoomReducer
} from "../app/components/student-task-room";
import type { FocusBlockRecord } from "../lib/storage/focus-block-store";
import type { StudentSourceProjection } from "../lib/domain/student-source-projection";
import { buildTaskSessionPlan } from "../lib/domain/task-session-plan";

type Priority = StudentSourceProjection["priorities"][number];

const packingPriority: Priority = {
  id: "priority:packing",
  rank: 1,
  priorityBand: "do_first",
  title: "Band Camp Packing Checklist",
  directions: "Use the director’s list to pack your instrument, water jug, drill book, sunscreen, and athletic shoes.",
  sourceLink: null,
  outbound: { available: true, policy: "guardian_approval" },
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
  it("turns a live priority into an evidence-backed, task-specific workroom", () => {
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
    expect(html).toContain("Ask your guardian to open");
    expect(html).not.toContain("href=");
    expect(html).toMatch(/Check the list|Find what is missing|Get items ready/);
    expect(html).toContain("CURRENT STEP");
    expect(html).toContain("See the full plan");
    expect(html).toContain("Assignment details");
    expect(html).toContain("My private work");
    expect(html).toContain("Pause and save");
    expect(html).toContain("0 of");
    expect(html).toContain("Homeroom never submits or changes this assignment");
    expect(html).toContain("Your session will be saved when you end it.");
    expect(html).not.toContain("Finish focus block");
    expect(html).not.toContain("End this focus session");
    expect((html.match(/>NOW</g) ?? [])).toHaveLength(1);
    expect(html).toContain('data-testid="task-room-focus-rail"');
    expect(html).toContain('data-testid="task-room-work-area"');
  });

  it("shows prior work and can resume a partial session without claiming the assignment is complete", () => {
    const prior: FocusBlockRecord = {
      id: "focus_01",
      studentId: "student_01",
      sessionId: "session_01",
      taskId: packingPriority.id,
      taskTitle: packingPriority.title,
      courseName: packingPriority.course.name,
      sourceProvider: "google_classroom",
      sourceExternalId: "packing",
      estimatedMinutes: 20,
      selectedMinutes: 15,
      elapsedSeconds: 420,
      completedChunkIds: ["packing:checklist_preparation:review_list"],
      completedChunkCount: 1,
      plannedChunkCount: 4,
      taskKind: "checklist_preparation",
      sourceStatus: "Not submitted",
      completedAt: "2026-07-19T16:00:00.000Z"
    };
    const html = renderToStaticMarkup(createElement(StudentTaskRoomContent, {
      priority: packingPriority,
      onClose: vi.fn(),
      previousSessions: [prior],
      resumeSession: prior
    }));

    expect(html).toContain("Previous sessions");
    expect(html).toContain("7 min worked");
    expect(html).toContain("1 of 4 steps");
    expect(html).toContain("Not submitted");
    expect(html).not.toContain("assignment complete");
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

    expect(withLearning).toContain("Need a lesson on this?");
    expect(withoutLearning).not.toContain("Need a lesson on this?");
  });

  it("advances to the next visible chunk as work is checked off", () => {
    const chunkIds = buildTaskSessionPlan({
      externalId: packingPriority.source.externalId,
      title: packingPriority.title,
      directions: packingPriority.directions,
      selectedMinutes: packingPriority.effort.recommendedTimeboxMinutes,
      maxSteps: 4
    }).steps.map((chunk) => chunk.id);
    let state = createTaskRoomState(packingPriority);

    expect(state.selectedChunkId).toBe(chunkIds[0]);
    state = taskRoomReducer(state, {
      type: "toggle_chunk",
      chunkId: chunkIds[0]!,
      orderedChunkIds: chunkIds
    });
    expect(state.completedChunkIds).toEqual([chunkIds[0]]);
    expect(state.selectedChunkId).toBe(chunkIds[1]);

    state = taskRoomReducer(state, {
      type: "toggle_chunk",
      chunkId: chunkIds[0]!,
      orderedChunkIds: chunkIds
    });
    expect(state.completedChunkIds).toEqual([]);
    expect(state.selectedChunkId).toBe(chunkIds[0]);
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
