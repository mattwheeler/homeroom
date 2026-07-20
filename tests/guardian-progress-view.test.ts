import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuardianProgress } from "../app/components/guardian-progress";
import type { GuardianProgressProjection } from "../lib/domain/guardian-progress";

const progress: GuardianProgressProjection = {
  student: { id: "student_emily", name: "Emily" },
  generatedAt: "2026-07-19T16:00:00.000Z",
  summary: { openTaskCount: 2, dueSoonCount: 1, focusSessionCount: 1, minutesFocused: 9 },
  tasks: [{
    taskId: "task_01",
    title: "Summer Reading Reflection",
    courseName: "English I - Period 1",
    dueLabel: "Due in 2 days",
    daysUntilDue: 2,
    estimatedMinutes: 20,
    sourceStatus: "Not submitted"
  }],
  recentSessions: [{
    id: "guardian_focus_01",
    taskId: "task_01",
    taskTitle: "Summer Reading Reflection",
    courseName: "English I - Period 1",
    completedStepCount: 1,
    plannedStepCount: 3,
    minutesFocused: 9,
    occurredAt: "2026-07-19T16:00:00.000Z",
    sourceStatus: "Not submitted"
  }],
  privacy: {
    visible: ["Tasks and due dates", "Focus-session progress", "Time spent", "School submission status"],
    keptPrivate: ["Private check-ins", "Homeroom chats", "Drafts and answers", "Coaching transcript"]
  }
};

describe("GuardianProgress", () => {
  it("gives the guardian useful progress feedback and states the privacy boundary", () => {
    const html = renderToStaticMarkup(createElement(GuardianProgress, { progress }));

    expect(html).toContain("Emily’s progress");
    expect(html).toContain("Summer Reading Reflection");
    expect(html).toContain("1 of 3 steps");
    expect(html).toContain("9 min");
    expect(html).toContain("Not submitted");
    expect(html).toContain("Private check-ins, chats, drafts, and answers stay with Emily");
  });
});
