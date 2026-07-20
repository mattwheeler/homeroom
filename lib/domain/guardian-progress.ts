import type { StudentSourceProjection } from "./student-source-projection";
import type { FocusBlockRecord } from "../storage/focus-block-store";

export interface GuardianTaskProgress {
  taskId: string;
  title: string;
  courseName: string;
  dueLabel: string;
  daysUntilDue: number | null;
  estimatedMinutes: number;
  sourceStatus: string;
}

export interface GuardianFocusSummary {
  id: string;
  taskId: string;
  taskTitle: string;
  courseName: string;
  completedStepCount: number;
  plannedStepCount: number;
  minutesFocused: number;
  occurredAt: string;
  sourceStatus: string;
}

export interface GuardianProgressProjection {
  student: { id: string; name: string };
  generatedAt: string;
  summary: {
    openTaskCount: number;
    dueSoonCount: number;
    focusSessionCount: number;
    minutesFocused: number;
  };
  tasks: GuardianTaskProgress[];
  recentSessions: GuardianFocusSummary[];
  privacy: {
    visible: string[];
    keptPrivate: string[];
  };
}

export function emptyGuardianProgress(student: { id: string; name: string }): GuardianProgressProjection {
  return {
    student,
    generatedAt: new Date(0).toISOString(),
    summary: { openTaskCount: 0, dueSoonCount: 0, focusSessionCount: 0, minutesFocused: 0 },
    tasks: [],
    recentSessions: [],
    privacy: {
      visible: ["Tasks and due dates", "Focus-session progress", "Time spent", "School submission status"],
      keptPrivate: ["Private check-ins", "Homeroom chats", "Drafts and answers", "Coaching transcript"]
    }
  };
}

export function buildGuardianProgress(input: {
  student: { id: string; name: string };
  projection: StudentSourceProjection;
  focusBlocks: readonly FocusBlockRecord[];
}): GuardianProgressProjection {
  const statusByTask = new Map(
    (input.projection.courseworkStatuses ?? []).map((status) => [status.taskId, status.label])
  );
  const tasks = input.projection.priorities.slice(0, 12).map((task): GuardianTaskProgress => ({
    taskId: task.id,
    title: task.title,
    courseName: task.course.name,
    dueLabel: task.urgency.label,
    daysUntilDue: task.urgency.daysUntilDue,
    estimatedMinutes: task.effort.estimatedMinutes,
    sourceStatus: statusByTask.get(task.id) ?? "School status not available"
  }));
  const recentSessions = input.focusBlocks.slice(0, 8).map((session, index): GuardianFocusSummary => ({
    id: `guardian-progress-${index + 1}-${session.taskId}`,
    taskId: session.taskId,
    taskTitle: session.taskTitle,
    courseName: session.courseName,
    completedStepCount: session.completedChunkCount,
    plannedStepCount: session.plannedChunkCount,
    minutesFocused: Math.max(1, Math.round(session.elapsedSeconds / 60)),
    occurredAt: session.completedAt,
    sourceStatus: statusByTask.get(session.taskId) ?? session.sourceStatus
  }));
  return {
    student: { id: input.student.id, name: input.student.name },
    generatedAt: input.projection.generatedAt,
    summary: {
      openTaskCount: tasks.length,
      dueSoonCount: tasks.filter((task) => task.daysUntilDue !== null && task.daysUntilDue <= 7).length,
      focusSessionCount: input.focusBlocks.length,
      minutesFocused: input.focusBlocks.reduce(
        (sum, session) => sum + Math.max(1, Math.round(session.elapsedSeconds / 60)),
        0
      )
    },
    tasks,
    recentSessions,
    privacy: {
      visible: ["Tasks and due dates", "Focus-session progress", "Time spent", "School submission status"],
      keptPrivate: ["Private check-ins", "Homeroom chats", "Drafts and answers", "Coaching transcript"]
    }
  };
}
