import type { CourseId } from "./learning-tracks";
import type { StudentSourceProjection } from "./student-source-projection";

export type StudentCheckInAction =
  | { kind: "task"; priorityId: string }
  | { kind: "calendar" }
  | { kind: "classes" }
  | { kind: "learning"; courseId: CourseId }
  | { kind: "planner" }
  | { kind: "rest" };

export interface StudentCheckInChoice {
  id: string;
  eyebrow: string;
  title: string;
  detail: string;
  timeLabel: string;
  actionLabel: string;
  visualToken: "coral" | "amber" | "blue" | "green" | "slate";
  action: StudentCheckInAction;
}

export interface StudentDailyCheckInModel {
  greeting: string;
  context: string;
  recommended: StudentCheckInChoice;
  alternatives: StudentCheckInChoice[];
}

function hourInTimeZone(value: Date, timeZone: string): number {
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(value).find((candidate) => candidate.type === "hour")?.value;
    const hour = Number(part);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 12;
  } catch {
    return 12;
  }
}

function greeting(studentName: string, hour: number): string {
  const dayPart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${dayPart}, ${studentName}.`;
}

function taskChoice(priority: StudentSourceProjection["priorities"][number], eyebrow: string): StudentCheckInChoice {
  return {
    id: priority.id,
    eyebrow,
    title: priority.title,
    detail: `${priority.course.name} · ${priority.urgency.label}`,
    timeLabel: `${priority.effort.recommendedTimeboxMinutes} min`,
    actionLabel: "Start the first step",
    visualToken: priority.urgency.visualToken === "red" ? "coral" : priority.urgency.visualToken,
    action: { kind: "task", priorityId: priority.id }
  };
}

function connectedContext(projection: StudentSourceProjection): string {
  const taskCount = projection.priorities.length;
  const events = projection.calendar?.items.filter(
    (item) => item.kind === "event" && item.date === projection.context.localDate
  ) ?? [];
  const taskText = taskCount === 1 ? "1 assignment" : `${taskCount} assignments`;
  if (taskCount > 0 && events.length > 0) {
    const first = events[0]!;
    return `Your connected sources show ${taskText} to organize and ${first.title} at ${first.timeLabel}.`;
  }
  if (taskCount > 0) return `Your connected sources show ${taskText} to organize.`;
  if (events.length > 0) {
    const first = events[0]!;
    return `Your connected calendar shows ${first.title} at ${first.timeLabel}.`;
  }
  return "Your connected sources show nothing requiring action right now.";
}

export function buildStudentDailyCheckIn(input: {
  studentName: string;
  projection: StudentSourceProjection;
  now?: Date;
}): StudentDailyCheckInModel {
  const now = input.now ?? new Date();
  const ordered = [...input.projection.priorities].sort((left, right) => left.rank - right.rank);
  const eventsToday = input.projection.calendar?.items.filter(
    (item) => item.kind === "event" && item.date === input.projection.context.localDate
  ) ?? [];
  const recommended = ordered[0]
    ? taskChoice(ordered[0], "Recommended next step")
    : {
        id: "caught-up",
        eyebrow: "Recommended next step",
        title: "Keep this moment open",
        detail: "No connected task needs your attention right now.",
        timeLabel: "Right now",
        actionLabel: "You’re caught up",
        visualToken: "green" as const,
        action: { kind: "rest" as const }
      };

  const alternatives: StudentCheckInChoice[] = ordered.slice(1, 3).map((priority) =>
    taskChoice(priority, "Another assignment")
  );
  if (alternatives.length < 3 && eventsToday[0]) {
    const event = eventsToday[0];
    alternatives.push({
      id: event.id,
      eyebrow: "Check today’s schedule",
      title: event.title,
      detail: event.statusLabel,
      timeLabel: event.timeLabel,
      actionLabel: "Open Calendar",
      visualToken: event.visualToken === "red" ? "coral" : event.visualToken,
      action: { kind: "calendar" }
    });
  }
  const learning = input.projection.learningRecommendations[0];
  if (alternatives.length < 3 && learning) {
    alternatives.push({
      id: learning.id,
      eyebrow: "Short practice",
      title: learning.missionTitle,
      detail: learning.courseName,
      timeLabel: `${learning.suggestedMinutes} min`,
      actionLabel: "Open learning room",
      visualToken: "blue",
      action: { kind: "learning", courseId: learning.courseId }
    });
  }
  if (alternatives.length < 2) {
    alternatives.push({
      id: "small-plan",
      eyebrow: "Organize the day",
      title: "Build a small plan",
      detail: "Choose what fits without changing school sources.",
      timeLabel: "2 min",
      actionLabel: "Open planner",
      visualToken: "amber",
      action: { kind: "planner" }
    });
  }
  if (alternatives.length < 2) {
    alternatives.push({
      id: "look-ahead",
      eyebrow: "Look ahead",
      title: "See the week",
      detail: "Review only the dates already in your connected sources.",
      timeLabel: "1 min",
      actionLabel: "Open Calendar",
      visualToken: "slate",
      action: { kind: "calendar" }
    });
  }

  return {
    greeting: greeting(input.studentName, hourInTimeZone(now, input.projection.context.timeZone)),
    context: connectedContext(input.projection),
    recommended,
    alternatives: alternatives.slice(0, 3)
  };
}
