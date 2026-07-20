import {
  buildStudentSupportPolicy,
  studentSupportProfileSchema,
  type ExecutiveSkill,
  type StudentSupportProfile
} from "./student-support-profile";
import { getLearningTrack, type CourseId } from "./learning-tracks";
import type { BandCalendarEvent } from "../source/band-calendar";
import type { ClassroomCourse, ClassroomCoursework } from "../source/google-classroom";
import type { SourceProvider, SourceSnapshot } from "../storage/source-connection-store";
import type { OfficialSchoolCalendarEvent } from "../source/official-school-calendar";
import type { SchoolSourceProvider, SchoolSourceSnapshot } from "../storage/school-source-store";
import {
  studentExternalLinkPolicySchema,
  studentOutboundResource,
  type StudentExternalLinkPolicy,
  type StudentOutboundResource
} from "./student-external-links";
import type { OfficialSupplyItem } from "../source/official-school-supplies";
import {
  buildTaskSessionPlan,
  classifyTaskSessionKind,
  type TaskSessionKind,
  type TaskSessionStep
} from "./task-session-plan";

export type StudentProjectionProfile = StudentSupportProfile & {
  timeZone: string;
  supportPreference: "example_first" | "questions_first" | "mix_it_up";
};

export interface ProjectionEvidence {
  provider: SourceProvider | SchoolSourceProvider;
  recordType: "course" | "coursework" | "calendar_event" | "supply_list";
  externalId: string;
  sourceUpdatedAt: string | null;
}

type UrgencyLevel = "overdue" | "today" | "tomorrow" | "soon" | "upcoming" | "later" | "unscheduled";
type VisualToken = "red" | "coral" | "amber" | "blue" | "green" | "slate";

export interface ProjectedPriority {
  id: string;
  rank: number;
  priorityBand: "do_first" | "plan_next" | "later";
  title: string;
  directions?: string | null;
  sourceLink?: string | null;
  outbound?: StudentOutboundResource;
  course: {
    externalId: string;
    name: string;
    trackCourseId: CourseId | null;
  };
  due: { date: string; time: string | null } | null;
  urgency: {
    level: UrgencyLevel;
    label: string;
    visualToken: VisualToken;
    daysUntilDue: number | null;
  };
  effort: {
    level: "quick" | "medium" | "deep";
    label: string;
    estimatedMinutes: number;
    recommendedTimeboxMinutes: number;
  };
  rationale: {
    summary: string;
    signals: string[];
  };
  sessionPlan?: { kind: TaskSessionKind; maxSteps: number };
  chunks: TaskSessionStep[];
  source: ProjectionEvidence;
}

export interface ProjectedCourseworkStatus {
  taskId: string;
  externalId: string;
  title: string;
  courseExternalId: string;
  courseName: string | null;
  state: string | null;
  label: string;
  isSourceComplete: boolean;
  sourceUpdatedAt: string | null;
}

export interface ProjectedSourceClass {
  externalId: string;
  name: string;
  section: string | null;
  subject: string | null;
  trackCourseId: CourseId | null;
  alternateLink: string | null;
  outbound?: StudentOutboundResource;
  source: ProjectionEvidence;
}

export interface ProjectedSupplyList {
  id: string;
  title: string;
  sourceTitle: string;
  items: OfficialSupplyItem[];
  outbound: StudentOutboundResource;
  source: ProjectionEvidence;
}

export interface ProjectedGuardianAssist {
  id: string;
  taskId: string;
  title: string;
  courseName: string;
  due: ProjectedPriority["due"];
  reason: string;
  source: ProjectionEvidence;
}

export interface ProjectedCalendarItem {
  id: string;
  kind: "coursework" | "event";
  title: string;
  date: string;
  timeLabel: string;
  startsAt: string | null;
  endsAt: string | null;
  courseExternalId: string | null;
  courseName: string | null;
  statusLabel: string;
  visualToken: VisualToken;
  category?: "schoolwork" | "band" | "school";
  source: ProjectionEvidence;
}

export interface StudentSourceProjection {
  generatedAt: string;
  context: {
    localDate: string;
    age: number;
    grade: number;
    timeZone: string;
    scaffoldLevel: "step_by_step" | "guided_choice" | "guided_independence" | "independent_planning";
    visualFirst: boolean;
  };
  sourceSummary: {
    courseCount: number;
    actionableCourseworkCount: number;
    completedCourseworkCount: number;
    eventCount: number;
    connections: SourceSnapshot["connections"];
    schoolConnections?: Array<Omit<SchoolSourceSnapshot["connections"][number], "sourceUrl">>;
  };
  outboundNavigation?: { externalLinks: StudentExternalLinkPolicy };
  skillScaffolds: Array<{
    skill: ExecutiveSkill;
    label: string;
    studentAction: string;
    adultBoundary: string;
    visualPattern: "timebox" | "course_buckets" | "urgency_effort_matrix";
    supportLevel: StudentSupportProfile["executiveSkills"]["timeManagement"];
  }>;
  today: {
    date: string;
    timeline: TimelineBlock[];
  };
  week: {
    startDate: string;
    endDate: string;
    days: Array<{ date: string; label: string; items: WeekItem[] }>;
  };
  priorities: ProjectedPriority[];
  courseworkStatuses?: ProjectedCourseworkStatus[];
  learningRecommendations: LearningRecommendation[];
  guardianAssistCandidates?: ProjectedGuardianAssist[];
  classes?: ProjectedSourceClass[];
  calendar?: { items: ProjectedCalendarItem[] };
  supplies?: ProjectedSupplyList[];
}

interface TimelineBlock {
  id: string;
  kind: "event" | "due_marker" | "focus_block";
  title: string;
  courseName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timeLabel: string;
  durationMinutes: number | null;
  placement: "source_scheduled" | "deadline" | "student_chooses_time";
  visualToken: VisualToken;
  source: ProjectionEvidence;
}

interface WeekItem {
  id: string;
  kind: "coursework" | "event";
  title: string;
  courseName: string | null;
  timeLabel: string;
  visualToken: VisualToken;
  source: ProjectionEvidence;
}

interface LearningRecommendation {
  id: string;
  courseId: CourseId;
  courseName: string;
  missionId: string;
  missionTitle: string;
  objective: string;
  suggestedMinutes: 10;
  supportPreference: StudentProjectionProfile["supportPreference"];
  rationale: string;
  visual: {
    format: "worked_example_then_steps" | "question_path" | "mixed_cards";
    stepCount: 2 | 3;
    progressStyle: "visible_timebox_and_steps";
  };
  evidence: ProjectionEvidence[];
}

export class StudentSourceProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudentSourceProjectionError";
  }
}

const COMPLETED_STATES = new Set(["TURNED_IN", "RETURNED"]);
const DAY_MS = 86_400_000;

function localDate(value: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((candidate) => candidate.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    if (!year || !month || !day) throw new Error("Missing date part.");
    return `${year}-${month}-${day}`;
  } catch {
    throw new StudentSourceProjectionError("The student time zone is invalid.");
  }
}

function dateOrdinal(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return Math.floor(time / DAY_MS);
}

function addDays(value: string, days: number): string {
  const ordinal = dateOrdinal(value);
  if (ordinal === null) throw new StudentSourceProjectionError("The projection date is invalid.");
  return new Date((ordinal + days) * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const left = dateOrdinal(from);
  const right = dateOrdinal(to);
  return left === null || right === null ? null : right - left;
}

function timeLabel(time: string | null): string {
  if (!time) return "Any time";
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return "Any time";
  const hour = Number(match[1]);
  const minutes = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${suffix}`;
}

function eventTimeLabel(event: BandCalendarEvent, timeZone: string): string {
  if (event.allDay || !event.startsAt.includes("T")) return "All day";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(event.startsAt));
  } catch {
    return "Scheduled";
  }
}

function urgency(daysUntilDue: number | null, late: boolean | null) {
  if (late || (daysUntilDue !== null && daysUntilDue < 0)) {
    return { level: "overdue" as const, label: "Overdue", visualToken: "red" as const, daysUntilDue };
  }
  if (daysUntilDue === 0) {
    return { level: "today" as const, label: "Due today", visualToken: "coral" as const, daysUntilDue };
  }
  if (daysUntilDue === 1) {
    return { level: "tomorrow" as const, label: "Due tomorrow", visualToken: "coral" as const, daysUntilDue };
  }
  if (daysUntilDue !== null && daysUntilDue <= 3) {
    return { level: "soon" as const, label: `Due in ${daysUntilDue} days`, visualToken: "amber" as const, daysUntilDue };
  }
  if (daysUntilDue !== null && daysUntilDue <= 7) {
    return { level: "upcoming" as const, label: `Due in ${daysUntilDue} days`, visualToken: "blue" as const, daysUntilDue };
  }
  if (daysUntilDue !== null) {
    return { level: "later" as const, label: `Due in ${daysUntilDue} days`, visualToken: "green" as const, daysUntilDue };
  }
  return { level: "unscheduled" as const, label: "No due date", visualToken: "slate" as const, daysUntilDue: null };
}

function estimateEffort(work: ClassroomCoursework, recommendedTimeboxLimit: number) {
  const value = `${work.title} ${work.description ?? ""}`.toLowerCase();
  const estimatedMinutes = /project|presentation|research|essay|lab report/.test(value)
    ? 45
    : /reflection|organizer|paragraph|reading|drawing|sketch/.test(value)
      ? 30
      : /exit ticket|one question|single question/.test(value)
        ? 15
      : /quiz|check|practice|review|problems?|vocabulary|identify|rhythm/.test(value)
        ? 20
        : 25;
  const level = estimatedMinutes <= 15 ? "quick" as const : estimatedMinutes <= 30 ? "medium" as const : "deep" as const;
  return {
    level,
    label: `${estimatedMinutes}-minute ${level === "deep" ? "deep-work" : "focus"} task`,
    estimatedMinutes,
    recommendedTimeboxMinutes: Math.min(estimatedMinutes, recommendedTimeboxLimit)
  };
}

function sourceForCoursework(work: ClassroomCoursework): ProjectionEvidence {
  return {
    provider: "google_classroom",
    recordType: "coursework",
    externalId: work.externalId,
    sourceUpdatedAt: work.updateTime
  };
}

function sourceForCourse(course: ClassroomCourse): ProjectionEvidence {
  return {
    provider: "google_classroom",
    recordType: "course",
    externalId: course.externalId,
    sourceUpdatedAt: null
  };
}

function sourceForEvent(event: BandCalendarEvent): ProjectionEvidence {
  return {
    provider: "band_ical",
    recordType: "calendar_event",
    externalId: event.uid,
    sourceUpdatedAt: event.sourceUpdatedAt
  };
}

function sourceForSchoolEvent(event: OfficialSchoolCalendarEvent): ProjectionEvidence {
  return {
    provider: "school_calendar",
    recordType: "calendar_event",
    externalId: event.uid,
    sourceUpdatedAt: event.sourceUpdatedAt
  };
}

function priorityBand(level: UrgencyLevel): ProjectedPriority["priorityBand"] {
  if (level === "overdue" || level === "today" || level === "tomorrow") return "do_first";
  if (level === "soon" || level === "upcoming") return "plan_next";
  return "later";
}

function statusSignal(work: ClassroomCoursework): string {
  if (work.submissionState === "TURNED_IN") return "Turned in";
  if (work.submissionState === "RETURNED") return "Returned";
  if (work.submissionState === "RECLAIMED_BY_STUDENT") return "Needs another submission";
  if (!work.submissionState || work.submissionState === "NEW" || work.submissionState === "CREATED") {
    return "Not submitted";
  }
  return "In progress";
}

function projectedPriority(input: {
  work: ClassroomCoursework;
  course: ClassroomCourse;
  currentDate: string;
  maxDirectionsAtOnce: 2 | 3;
  recommendedTimeboxLimit: number;
  externalLinkPolicy: StudentExternalLinkPolicy;
}): ProjectedPriority {
  const days = daysBetween(input.currentDate, input.work.dueDate);
  const urgencyValue = urgency(days, input.work.late);
  const effort = estimateEffort(input.work, input.recommendedTimeboxLimit);
  const status = statusSignal(input.work);
  const taskKind = classifyTaskSessionKind(input.work);
  const maxSteps = input.maxDirectionsAtOnce === 2 ? 2 : 4;
  const sessionPlan = buildTaskSessionPlan({
    externalId: input.work.externalId,
    title: input.work.title,
    directions: input.work.description,
    workType: input.work.workType,
    taskKind,
    selectedMinutes: effort.recommendedTimeboxMinutes,
    maxSteps
  });
  const signals = [urgencyValue.label, `About ${effort.estimatedMinutes} minutes`, status];
  return {
    id: `google_classroom:coursework:${input.work.externalId}`,
    rank: 0,
    priorityBand: priorityBand(urgencyValue.level),
    title: input.work.title,
    directions: input.work.description?.trim() || null,
    sourceLink: null,
    outbound: studentOutboundResource(Boolean(input.work.alternateLink), input.externalLinkPolicy),
    course: {
      externalId: input.course.externalId,
      name: input.course.name,
      trackCourseId: input.course.trackCourseId
    },
    due: days !== null && input.work.dueDate
      ? { date: input.work.dueDate, time: input.work.dueTime }
      : null,
    urgency: urgencyValue,
    effort,
    rationale: {
      summary: `${urgencyValue.label} · ${effort.estimatedMinutes} minutes · ${status.toLowerCase()}.`,
      signals
    },
    sessionPlan: { kind: sessionPlan.kind, maxSteps },
    chunks: sessionPlan.steps,
    source: sourceForCoursework(input.work)
  };
}

function prioritySort(left: ProjectedPriority, right: ProjectedPriority): number {
  const urgencyRank: Record<UrgencyLevel, number> = {
    overdue: 0,
    today: 1,
    tomorrow: 2,
    soon: 3,
    upcoming: 4,
    later: 5,
    unscheduled: 6
  };
  return urgencyRank[left.urgency.level] - urgencyRank[right.urgency.level]
    || (left.urgency.daysUntilDue ?? Number.MAX_SAFE_INTEGER) - (right.urgency.daysUntilDue ?? Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title)
    || left.source.externalId.localeCompare(right.source.externalId);
}

function guardianAssistCandidate(priority: ProjectedPriority): ProjectedGuardianAssist | null {
  const text = `${priority.title}\n${priority.directions ?? ""}`;
  const namesGuardian = /\b(parent|guardian|adult|family)\b/i.test(text);
  const asksGuardianAction = /\b(sign|signature|permission|consent|form|physical|medical|fee|payment|purchase|transportation|ride|registration)\b/i.test(text);
  const inherentlyGuardianTask = /\b(physical form|permission slip|consent form|registration fee|parent signature|guardian signature)\b/i.test(text);
  if (!(inherentlyGuardianTask || (namesGuardian && asksGuardianAction))) return null;
  return {
    id: `guardian:${priority.id}`,
    taskId: priority.id,
    title: priority.title,
    courseName: priority.course.name,
    due: priority.due,
    reason: "The connected school source indicates that a parent or guardian may need to handle this item.",
    source: priority.source
  };
}

function eventLocalDate(event: BandCalendarEvent, timeZone: string): string | null {
  if (!event.startsAt.includes("T")) return dateOrdinal(event.startsAt) === null ? null : event.startsAt;
  const parsed = new Date(event.startsAt);
  return Number.isNaN(parsed.getTime()) ? null : localDate(parsed, timeZone);
}

function schoolEventTimeLabel(event: OfficialSchoolCalendarEvent, timeZone: string): string {
  if (event.allDay || !event.startsAt.includes("T")) return "All day";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
      .format(new Date(event.startsAt));
  } catch {
    return "Scheduled";
  }
}

function relevantSchoolEvents(snapshot: SchoolSourceSnapshot | undefined, grade: number) {
  return (snapshot?.events ?? []).filter((event) =>
    event.audience === "all_students" || (event.audience === "elementary" && grade <= 5)
  );
}

function schoolEventStatus(event: OfficialSchoolCalendarEvent): string {
  if (event.category === "school_closed") return "School closed";
  if (event.category === "student_holiday") return "Student holiday";
  if (event.category === "early_release") return "Early release";
  if (event.category === "registration") return "Registration";
  return "School event";
}

function dayLabel(date: string, timeZone: string): string {
  const ordinal = dateOrdinal(date);
  if (ordinal === null) return date;
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" })
    .format(new Date(ordinal * DAY_MS + 12 * 60 * 60 * 1_000));
}

function visualFormat(preference: StudentProjectionProfile["supportPreference"]): LearningRecommendation["visual"]["format"] {
  if (preference === "example_first") return "worked_example_then_steps";
  if (preference === "questions_first") return "question_path";
  return "mixed_cards";
}

export function projectStudentSources(input: {
  snapshot: SourceSnapshot;
  schoolSnapshot?: SchoolSourceSnapshot;
  profile: StudentProjectionProfile;
  externalLinkPolicy?: StudentExternalLinkPolicy;
  now?: Date;
}): StudentSourceProjection {
  const supportProfile: StudentSupportProfile = {
    studentId: input.profile.studentId,
    name: input.profile.name,
    age: input.profile.age,
    grade: input.profile.grade,
    learningModalities: input.profile.learningModalities,
    executiveSkills: input.profile.executiveSkills
  };
  const parsedProfile = studentSupportProfileSchema.safeParse(supportProfile);
  if (!parsedProfile.success) {
    throw new StudentSourceProjectionError("The student support profile is invalid.");
  }
  if (!["example_first", "questions_first", "mix_it_up"].includes(input.profile.supportPreference)) {
    throw new StudentSourceProjectionError("The student support preference is invalid.");
  }
  const externalLinkPolicy = studentExternalLinkPolicySchema.safeParse(
    input.externalLinkPolicy ?? "blocked"
  );
  if (!externalLinkPolicy.success) {
    throw new StudentSourceProjectionError("The external-link policy is invalid.");
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new StudentSourceProjectionError("The projection time is invalid.");
  const currentDate = localDate(now, input.profile.timeZone);
  const policy = buildStudentSupportPolicy(parsedProfile.data);
  const scaffoldLevel = policy.developmentalStage === "elementary"
    ? "step_by_step" as const
    : policy.developmentalStage === "middle_school"
      ? "guided_choice" as const
      : policy.developmentalStage === "early_high_school"
        ? "guided_independence" as const
        : "independent_planning" as const;
  const recommendedTimeboxLimit = policy.developmentalStage === "elementary"
    ? 15
    : policy.developmentalStage === "middle_school"
      ? 20
      : policy.developmentalStage === "early_high_school"
        ? 30
        : 35;
  const courses = new Map(input.snapshot.courses.map((course) => [course.externalId, course]));
  const actionable = input.snapshot.coursework.filter((work) => !COMPLETED_STATES.has(work.submissionState ?? ""));
  const completedCount = input.snapshot.coursework.length - actionable.length;
  const priorities = actionable.flatMap((work) => {
    const course = courses.get(work.courseExternalId);
    return course ? [projectedPriority({
      work,
      course,
      currentDate,
      maxDirectionsAtOnce: policy.maxDirectionsAtOnce,
      recommendedTimeboxLimit,
      externalLinkPolicy: externalLinkPolicy.data
    })] : [];
  }).sort(prioritySort).map((priority, index) => ({ ...priority, rank: index + 1 }));
  const courseworkStatuses: ProjectedCourseworkStatus[] = input.snapshot.coursework.map((work) => ({
    taskId: `google_classroom:coursework:${work.externalId}`,
    externalId: work.externalId,
    title: work.title,
    courseExternalId: work.courseExternalId,
    courseName: courses.get(work.courseExternalId)?.name ?? null,
    state: work.submissionState,
    label: statusSignal(work),
    isSourceComplete: COMPLETED_STATES.has(work.submissionState ?? ""),
    sourceUpdatedAt: work.updateTime
  }));
  const schoolEvents = relevantSchoolEvents(input.schoolSnapshot, parsedProfile.data.grade);

  const todayTimeline: TimelineBlock[] = [];
  for (const event of input.snapshot.events) {
    if (eventLocalDate(event, input.profile.timeZone) !== currentDate) continue;
    todayTimeline.push({
      id: `band_ical:event:${event.uid}`,
      kind: "event",
      title: event.title,
      courseName: null,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeLabel: eventTimeLabel(event, input.profile.timeZone),
      durationMinutes: event.endsAt && event.startsAt.includes("T")
        ? Math.max(0, Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000))
        : null,
      placement: "source_scheduled",
      visualToken: "green",
      source: sourceForEvent(event)
    });
  }
  for (const event of schoolEvents) {
    if (eventLocalDate(event as unknown as BandCalendarEvent, input.profile.timeZone) !== currentDate) continue;
    todayTimeline.push({
      id: `school_calendar:event:${event.uid}`,
      kind: "event",
      title: event.title,
      courseName: null,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeLabel: schoolEventTimeLabel(event, input.profile.timeZone),
      durationMinutes: null,
      placement: "source_scheduled",
      visualToken: event.category === "school_closed" || event.category === "student_holiday" ? "blue" : "amber",
      source: sourceForSchoolEvent(event)
    });
  }
  for (const priority of priorities.filter((item) => item.due?.date === currentDate)) {
    todayTimeline.push({
      id: `${priority.id}:due`,
      kind: "due_marker",
      title: priority.title,
      courseName: priority.course.name,
      startsAt: null,
      endsAt: null,
      timeLabel: timeLabel(priority.due?.time ?? null),
      durationMinutes: null,
      placement: "deadline",
      visualToken: priority.urgency.visualToken,
      source: priority.source
    });
  }
  const firstPriority = priorities[0];
  if (firstPriority) {
    todayTimeline.push({
      id: `${firstPriority.id}:focus`,
      kind: "focus_block",
      title: `Focus: ${firstPriority.title}`,
      courseName: firstPriority.course.name,
      startsAt: null,
      endsAt: null,
      timeLabel: "Choose a time",
      durationMinutes: firstPriority.effort.recommendedTimeboxMinutes,
      placement: "student_chooses_time",
      visualToken: firstPriority.urgency.visualToken,
      source: firstPriority.source
    });
  }
  todayTimeline.sort((left, right) => {
    const kindRank = { event: 0, due_marker: 1, focus_block: 2 } as const;
    return kindRank[left.kind] - kindRank[right.kind]
      || (left.startsAt ?? "z").localeCompare(right.startsAt ?? "z")
      || left.title.localeCompare(right.title);
  });

  const weekEnd = addDays(currentDate, 6);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(currentDate, index)).map((date) => {
    const items: WeekItem[] = priorities.filter((priority) => priority.due?.date === date).map((priority) => ({
      id: `${priority.id}:week`,
      kind: "coursework",
      title: priority.title,
      courseName: priority.course.name,
      timeLabel: timeLabel(priority.due?.time ?? null),
      visualToken: priority.urgency.visualToken,
      source: priority.source
    }));
    for (const event of input.snapshot.events) {
      if (eventLocalDate(event, input.profile.timeZone) !== date) continue;
      items.push({
        id: `band_ical:event:${event.uid}:week`,
        kind: "event",
        title: event.title,
        courseName: null,
        timeLabel: eventTimeLabel(event, input.profile.timeZone),
        visualToken: "green",
        source: sourceForEvent(event)
      });
    }
    for (const event of schoolEvents) {
      if (eventLocalDate(event as unknown as BandCalendarEvent, input.profile.timeZone) !== date) continue;
      items.push({
        id: `school_calendar:event:${event.uid}:week`,
        kind: "event",
        title: event.title,
        courseName: null,
        timeLabel: schoolEventTimeLabel(event, input.profile.timeZone),
        visualToken: event.category === "school_closed" || event.category === "student_holiday" ? "blue" : "amber",
        source: sourceForSchoolEvent(event)
      });
    }
    items.sort((left, right) => left.timeLabel.localeCompare(right.timeLabel) || left.title.localeCompare(right.title));
    return { date, label: dayLabel(date, input.profile.timeZone), items };
  });

  const usedCourses = new Set<string>();
  const learningRecommendations: LearningRecommendation[] = [];
  for (const priority of priorities) {
    const course = courses.get(priority.course.externalId);
    if (!course?.trackCourseId || usedCourses.has(course.externalId)) continue;
    const track = getLearningTrack(course.trackCourseId);
    usedCourses.add(course.externalId);
    learningRecommendations.push({
      id: `learning:${course.externalId}:${track.mission.id}`,
      courseId: track.courseId,
      courseName: course.name,
      missionId: track.mission.id,
      missionTitle: track.mission.title,
      objective: track.mission.objective,
      suggestedMinutes: track.mission.suggestedMinutes,
      supportPreference: input.profile.supportPreference,
      rationale: `${priority.urgency.label}: ${priority.title} connects to this readiness mission.`,
      visual: {
        format: visualFormat(input.profile.supportPreference),
        stepCount: policy.maxDirectionsAtOnce,
        progressStyle: "visible_timebox_and_steps"
      },
      evidence: [sourceForCourse(course), priority.source]
    });
    if (learningRecommendations.length === 3) break;
  }

  const visualPattern: Record<ExecutiveSkill, StudentSourceProjection["skillScaffolds"][number]["visualPattern"]> = {
    time_management: "timebox",
    organization: "course_buckets",
    prioritization: "urgency_effort_matrix"
  };
  const projectedClasses: ProjectedSourceClass[] = input.snapshot.courses.map((course) => ({
    externalId: course.externalId,
    name: course.name,
    section: course.section,
    subject: course.subject,
    trackCourseId: course.trackCourseId,
    alternateLink: null,
    outbound: studentOutboundResource(Boolean(course.alternateLink), externalLinkPolicy.data),
    source: sourceForCourse(course)
  }));
  const calendarItems: ProjectedCalendarItem[] = priorities.flatMap((priority) => priority.due ? [{
    id: `${priority.id}:calendar`,
    kind: "coursework" as const,
    title: priority.title,
    date: priority.due.date,
    timeLabel: timeLabel(priority.due.time),
    startsAt: null,
    endsAt: null,
    courseExternalId: priority.course.externalId,
    courseName: priority.course.name,
    statusLabel: priority.urgency.label,
    visualToken: priority.urgency.visualToken,
    category: "schoolwork" as const,
    source: priority.source
  }] : []);
  for (const event of input.snapshot.events) {
    const date = eventLocalDate(event, input.profile.timeZone);
    if (!date) continue;
    calendarItems.push({
      id: `band_ical:event:${event.uid}:calendar`,
      kind: "event",
      title: event.title,
      date,
      timeLabel: eventTimeLabel(event, input.profile.timeZone),
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      courseExternalId: null,
      courseName: null,
      statusLabel: event.status === "CANCELLED" ? "Cancelled" : "Scheduled",
      visualToken: event.status === "CANCELLED" ? "slate" : "green",
      category: "band",
      source: sourceForEvent(event)
    });
  }
  for (const event of schoolEvents) {
    const date = eventLocalDate(event as unknown as BandCalendarEvent, input.profile.timeZone);
    if (!date) continue;
    calendarItems.push({
      id: `school_calendar:event:${event.uid}:calendar`,
      kind: "event",
      title: event.title,
      date,
      timeLabel: schoolEventTimeLabel(event, input.profile.timeZone),
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      courseExternalId: null,
      courseName: null,
      statusLabel: schoolEventStatus(event),
      visualToken: event.category === "school_closed" || event.category === "student_holiday" ? "blue" : "amber",
      category: "school",
      source: sourceForSchoolEvent(event)
    });
  }
  calendarItems.sort((left, right) => left.date.localeCompare(right.date)
    || left.timeLabel.localeCompare(right.timeLabel)
    || left.title.localeCompare(right.title));

  return {
    generatedAt: now.toISOString(),
    context: {
      localDate: currentDate,
      age: parsedProfile.data.age,
      grade: parsedProfile.data.grade,
      timeZone: input.profile.timeZone,
      scaffoldLevel,
      visualFirst: policy.visualFirst
    },
    sourceSummary: {
      courseCount: input.snapshot.courses.length,
      actionableCourseworkCount: priorities.length,
      completedCourseworkCount: completedCount,
      eventCount: input.snapshot.events.length + schoolEvents.length,
      connections: input.snapshot.connections,
      schoolConnections: (input.schoolSnapshot?.connections ?? []).map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        status: connection.status,
        displayName: connection.displayName,
        lastSyncAt: connection.lastSyncAt,
        lastErrorCode: connection.lastErrorCode
      }))
    },
    outboundNavigation: { externalLinks: externalLinkPolicy.data },
    skillScaffolds: policy.requiredExecutiveRoutines.map((routine) => ({
      ...routine,
      visualPattern: visualPattern[routine.skill],
      supportLevel: routine.skill === "time_management"
        ? parsedProfile.data.executiveSkills.timeManagement
        : routine.skill === "organization"
          ? parsedProfile.data.executiveSkills.organization
          : parsedProfile.data.executiveSkills.prioritization
    })),
    today: { date: currentDate, timeline: todayTimeline },
    week: { startDate: currentDate, endDate: weekEnd, days: weekDays },
    priorities,
    courseworkStatuses,
    learningRecommendations,
    guardianAssistCandidates: priorities.flatMap((priority) => {
      const candidate = guardianAssistCandidate(priority);
      return candidate ? [candidate] : [];
    }),
    classes: projectedClasses,
    calendar: { items: calendarItems },
    supplies: (input.schoolSnapshot?.supplyLists ?? []).map((list, index) => ({
      id: `school_supplies:${index}`,
      title: list.title,
      sourceTitle: list.sourceTitle,
      items: list.items,
      outbound: studentOutboundResource(Boolean(list.sourceUrl), externalLinkPolicy.data),
      source: {
        provider: "school_supplies",
        recordType: "supply_list",
        externalId: `school_supplies:${index}`,
        sourceUpdatedAt: null
      }
    }))
  };
}
