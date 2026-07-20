"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

import type { CourseId } from "../../lib/domain/learning-tracks";
import type { StudentCheckInAction } from "../../lib/domain/student-daily-check-in";
import { buildStudentLearningOptions } from "../../lib/domain/student-learning-options";
import type {
  ProjectedPriority,
  StudentSourceProjection
} from "../../lib/domain/student-source-projection";
import { StudentDailyCheckIn } from "./student-daily-check-in";
import { StudentActivityHistory } from "./student-activity-history";
import { StudentFamilyAssist } from "./student-family-assist";
import { StudentPlanningBoardView } from "./student-planning-board";
import { StudentTaskRoom, type StudentTaskRoomResult } from "./student-task-room";
import styles from "./student-home.module.css";
import type { FocusBlockRecord } from "../../lib/storage/focus-block-store";

const LearningWorkspace = dynamic(
  () => import("./learning-workspace").then((module) => module.LearningWorkspace),
  { ssr: false, loading: () => <section className={styles.loading}>Opening the learning room…</section> }
);
const StudentAIPlanner = dynamic(
  () => import("./student-ai-planner").then((module) => module.StudentAIPlanner),
  { ssr: false, loading: () => <section className={styles.loading}>Opening the planner…</section> }
);
const StudentCalendar = dynamic(
  () => import("./student-calendar").then((module) => module.StudentCalendar),
  { ssr: false, loading: () => <section className={styles.loading}>Opening Calendar…</section> }
);
const StudentClasses = dynamic(
  () => import("./student-classes").then((module) => module.StudentClasses),
  { ssr: false, loading: () => <section className={styles.loading}>Opening Classes…</section> }
);
const StudentSupplies = dynamic(
  () => import("./student-supplies").then((module) => module.StudentSupplies),
  { ssr: false, loading: () => <section className={styles.loading}>Opening Supplies…</section> }
);

type StudentView = "today" | "calendar" | "classes" | "supplies" | "learn";

interface Student {
  name: string;
  grade: number;
}

const tabs: Array<{ id: StudentView; label: string; icon: string }> = [
  { id: "today", label: "Today", icon: "✦" },
  { id: "calendar", label: "Calendar", icon: "▦" },
  { id: "classes", label: "Classes", icon: "▤" },
  { id: "supplies", label: "Supplies", icon: "◫" },
  { id: "learn", label: "Learn", icon: "◇" }
];

function errorMessage(value: unknown): string {
  if (!value || typeof value !== "object" || !("error" in value)) return "Homeroom could not start yet.";
  const error = value.error;
  if (!error || typeof error !== "object" || !("message" in error)) return "Homeroom could not start yet.";
  return typeof error.message === "string" ? error.message : "Homeroom could not start yet.";
}

function dateInTimeZone(value: string, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(value));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

export function StudentHome({ student }: { student: Student }) {
  const [view, setView] = useState<StudentView>("today");
  const [status, setStatus] = useState<"starting" | "active" | "error">("starting");
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const bootstrapRequest = useRef<Promise<{
    csrfToken: string;
    projection: StudentSourceProjection;
  }> | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [projection, setProjection] = useState<StudentSourceProjection | null>(null);
  const [projectionError, setProjectionError] = useState("");
  const [error, setError] = useState("");
  const [selectedPriority, setSelectedPriority] = useState<ProjectedPriority | null>(null);
  const [completedPriorityIds, setCompletedPriorityIds] = useState<string[]>([]);
  const [focusBlocks, setFocusBlocks] = useState<FocusBlockRecord[]>([]);
  const [resumeFocusBlock, setResumeFocusBlock] = useState<FocusBlockRecord | null>(null);
  const [reentry, setReentry] = useState<{ active: boolean; title: string; message: string; missedDayCount: number } | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [learningCourseId, setLearningCourseId] = useState<CourseId | null>(null);
  const [learningRequestKey, setLearningRequestKey] = useState(0);

  const displayedCourses = useMemo(
    () => projection ? buildStudentLearningOptions(projection, student.grade) : [],
    [projection, student.grade]
  );

  useEffect(() => {
    let cancelled = false;
    if (!bootstrapRequest.current) {
      bootstrapRequest.current = (async () => {
        const response = await fetch("/api/student/bootstrap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        });
        const data = await response.json() as {
          csrfToken?: unknown;
          projection?: unknown;
          error?: { message?: string };
        };
        if (
          !response.ok ||
          typeof data.csrfToken !== "string" ||
          !data.projection ||
          typeof data.projection !== "object" ||
          !("today" in data.projection)
        ) {
          throw new Error(errorMessage(data));
        }
        return {
          csrfToken: data.csrfToken,
          projection: data.projection as StudentSourceProjection
        };
      })();
    }
    void bootstrapRequest.current.then((result) => {
      if (cancelled) return;
      setCsrfToken(result.csrfToken);
      setProjection(result.projection);
      setStatus("active");
    }).catch((caught) => {
      if (cancelled) return;
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Your Today page could not be opened yet.");
    });
    return () => { cancelled = true; };
  }, [bootstrapAttempt]);

  useEffect(() => {
    if (status !== "active" || !csrfToken) return;
    const controller = new AbortController();
    void fetch("/api/focus-blocks", {
      method: "POST",
      headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
      body: JSON.stringify({ action: "list" }),
      signal: controller.signal
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) return;
      const records = (data.focusBlocks ?? []) as FocusBlockRecord[];
      setFocusBlocks(records);
      setCompletedPriorityIds(records
        .filter((item) => dateInTimeZone(
          item.completedAt,
          projection?.context.timeZone ?? "America/Chicago"
        ) === projection?.context.localDate)
        .map((item) => item.taskId));
      setReentry(data.reentry ?? null);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [csrfToken, projection?.context.localDate, projection?.context.timeZone, status]);

  useEffect(() => {
    if (!plannerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [plannerOpen]);

  function retryBootstrap() {
    bootstrapRequest.current = null;
    setStatus("starting");
    setError("");
    setProjectionError("");
    setProjection(null);
    setBootstrapAttempt((current) => current + 1);
  }

  function openView(nextView: StudentView) {
    if (status === "active") setView(nextView);
  }

  function openLearningRoom(courseId: CourseId) {
    setSelectedPriority(null);
    setPlannerOpen(false);
    setLearningCourseId(courseId);
    setLearningRequestKey((current) => current + 1);
    setView("learn");
  }

  function openTask(priority: ProjectedPriority, resumeSession: FocusBlockRecord | null = null) {
    setResumeFocusBlock(resumeSession);
    setSelectedPriority(priority);
  }

  function handleCheckInAction(action: StudentCheckInAction) {
    if (action.kind === "task") {
      const priority = projection?.priorities.find((candidate) => candidate.id === action.priorityId);
      if (priority) openTask(priority);
      return;
    }
    if (action.kind === "calendar") {
      setView("calendar");
      return;
    }
    if (action.kind === "classes") {
      setView("classes");
      return;
    }
    if (action.kind === "learning") {
      openLearningRoom(action.courseId);
      return;
    }
    if (action.kind === "planner") setPlannerOpen(true);
  }

  async function finishTask(result: StudentTaskRoomResult) {
    try {
      const response = await fetch("/api/focus-blocks", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({
          action: "complete",
          priorityId: result.priorityId,
          selectedMinutes: result.selectedTimeboxMinutes,
          elapsedSeconds: result.elapsedSeconds,
          completedChunkIds: result.completedChunkIds
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Your focus could not be saved yet.");
      if (data.focusBlock) {
        setFocusBlocks((current) => [data.focusBlock as FocusBlockRecord, ...current]);
      }
      setCompletedPriorityIds((current) => current.includes(result.priorityId) ? current : [...current, result.priorityId]);
      setReentry(data.reentry ?? null);
    } catch (caught) {
      setProjectionError(caught instanceof Error ? caught.message : "Your focus could not be saved yet.");
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <button className={styles.brand} type="button" onClick={() => openView("today")} aria-label="Homeroom Today">
          <span>✦</span><strong>homeroom</strong>
        </button>
        <nav className={styles.tabs} role="tablist" aria-label="Student workspace">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`student-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              aria-controls={`student-panel-${tab.id}`}
              className={view === tab.id ? styles.activeTab : ""}
              disabled={status !== "active"}
              onClick={() => openView(tab.id)}
            ><span aria-hidden="true">{tab.icon}</span>{tab.label}</button>
          ))}
        </nav>
        <Link className={styles.identity} href="/" aria-label="Switch Homeroom profile"><span>E</span><div><strong>{student.name}</strong><small>Grade {student.grade} · switch</small></div></Link>
      </header>

      <section className={`${styles.workspace} ${view === "today" && status === "active" ? styles.todayWorkspaceShell : ""}`}>
          {status === "starting" && (
            <section className={styles.todayLifecycle} aria-live="polite" aria-labelledby="student-today-loading-title">
              <span className={styles.lifecyclePulse} aria-hidden="true">✦</span>
              <p>VERIFIED STUDENT SPACE</p>
              <h1 id="student-today-loading-title">Opening {student.name}’s Today page</h1>
              <span>Connecting verified school sources and finding one useful next step…</span>
            </section>
          )}
          {status === "error" && (
            <section className={styles.todayLifecycle} role="alert" aria-labelledby="student-today-error-title">
              <span className={styles.lifecyclePulse} aria-hidden="true">↻</span>
              <p>TODAY NEEDS ANOTHER TRY</p>
              <h1 id="student-today-error-title">Your school day did not load yet.</h1>
              <span>{error}</span>
              <div><button type="button" onClick={retryBootstrap}>Try Today again</button><Link href="/">Return to sign in</Link></div>
            </section>
          )}
          {status === "active" && (
            <>
          {projectionError && <p className={styles.error} role="alert">{projectionError}</p>}
          {!projection && !projectionError && <section className={styles.loading} aria-live="polite">Connecting Classroom and calendar…</section>}

          {projection && view === "today" && (
            <div id="student-panel-today" role="tabpanel" aria-labelledby="student-tab-today">
              {reentry?.active && <p className={styles.completionNotice}><strong>{reentry.title}</strong> {reentry.message}</p>}
              {completedPriorityIds.length > 0 && <p className={styles.completionNotice}>✓ Focus block saved in Homeroom. Your school source remains unchanged until you submit there.</p>}
              <StudentDailyCheckIn
                studentName={student.name}
                projection={projection}
                csrfToken={csrfToken}
                onAction={handleCheckInAction}
                primaryContent={(
                  <div className={styles.todayPrimaryColumn}>
                    <StudentPlanningBoardView
                      projection={projection}
                      view="today"
                      presentation="workspace"
                      onOpenTask={(priority) => openTask(priority)}
                      onOpenPlanner={() => setPlannerOpen(true)}
                      completedPriorityIds={completedPriorityIds}
                    />
                    <StudentFamilyAssist csrfToken={csrfToken} candidate={projection.guardianAssistCandidates?.[0] ?? null} />
                  </div>
                )}
              />
              <StudentActivityHistory
                focusBlocks={focusBlocks}
                projection={projection}
                onResume={(priority, session) => openTask(priority, session)}
                onRestart={(priority) => openTask(priority)}
              />
            </div>
          )}
          {projection && view === "calendar" && (
            <div id="student-panel-calendar" role="tabpanel" aria-labelledby="student-tab-calendar">
              <StudentCalendar projection={projection} onOpenTask={(priority) => openTask(priority)} />
            </div>
          )}
          {projection && view === "classes" && (
            <div id="student-panel-classes" role="tabpanel" aria-labelledby="student-tab-classes">
              <StudentClasses projection={projection} onOpenLearning={openLearningRoom} onOpenTask={(priority) => openTask(priority)} />
            </div>
          )}
          {projection && view === "supplies" && (
            <div id="student-panel-supplies" role="tabpanel" aria-labelledby="student-tab-supplies">
              <StudentSupplies projection={projection} />
            </div>
          )}
          {projection && view === "learn" && (
            <div id="student-panel-learn" role="tabpanel" aria-labelledby="student-tab-learn">
              <LearningWorkspace key={learningRequestKey} courses={displayedCourses} csrfToken={csrfToken} initialCourseId={learningCourseId} grade={student.grade} />
            </div>
          )}
            </>
          )}
      </section>

      {selectedPriority && (
        <StudentTaskRoom
          key={selectedPriority.id}
          priority={selectedPriority}
          onClose={() => { setSelectedPriority(null); setResumeFocusBlock(null); }}
          onFinish={(result) => void finishTask(result)}
          onOpenLearning={openLearningRoom}
          previousSessions={focusBlocks.filter((item) => item.taskId === selectedPriority.id)}
          resumeSession={resumeFocusBlock}
        />
      )}

      {status === "active" && (
        <div className={styles.plannerOverlay} hidden={!plannerOpen}>
          <section className={styles.plannerRoom} role="dialog" aria-modal="true" aria-labelledby="student-ai-planner-room-title">
            <header>
              <button type="button" onClick={() => setPlannerOpen(false)}>← Back to Today</button>
              <div><span>Live school-day plan</span><strong id="student-ai-planner-room-title">Build a routine from today’s real sources</strong></div>
              <span>Your routine stays yours</span>
            </header>
            <div><StudentAIPlanner csrfToken={csrfToken} studentName={student.name} onOpenLearningRoom={openLearningRoom} /></div>
          </section>
        </div>
      )}

      <footer className={styles.footer}><span>♢ Private by design</span><span>Your work stays in your student space.</span></footer>
    </main>
  );
}
