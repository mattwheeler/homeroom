"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";

import type { CourseId } from "../../lib/domain/learning-tracks";
import { buildStudentLearningOptions } from "../../lib/domain/student-learning-options";
import type {
  ProjectedPriority,
  StudentSourceProjection
} from "../../lib/domain/student-source-projection";
import { LearningWorkspace } from "./learning-workspace";
import { StudentAIPlanner } from "./student-ai-planner";
import { StudentCalendar } from "./student-calendar";
import { StudentClasses } from "./student-classes";
import { StudentFamilyAssist } from "./student-family-assist";
import { StudentPlanningBoardView } from "./student-planning-board";
import { StudentTaskRoom, type StudentTaskRoomResult } from "./student-task-room";
import { StudentSupplies } from "./student-supplies";
import styles from "./student-home.module.css";

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

export function StudentHome({ student }: { student: Student }) {
  const hydrated = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [view, setView] = useState<StudentView>("today");
  const [status, setStatus] = useState<"idle" | "starting" | "active" | "error">("idle");
  const [csrfToken, setCsrfToken] = useState("");
  const [projection, setProjection] = useState<StudentSourceProjection | null>(null);
  const [projectionError, setProjectionError] = useState("");
  const [error, setError] = useState("");
  const [selectedPriority, setSelectedPriority] = useState<ProjectedPriority | null>(null);
  const [completedPriorityIds, setCompletedPriorityIds] = useState<string[]>([]);
  const [reentry, setReentry] = useState<{ active: boolean; title: string; message: string; missedDayCount: number } | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [learningCourseId, setLearningCourseId] = useState<CourseId | null>(null);
  const [learningRequestKey, setLearningRequestKey] = useState(0);

  const displayedCourses = useMemo(
    () => projection ? buildStudentLearningOptions(projection, student.grade) : [],
    [projection, student.grade]
  );

  useEffect(() => {
    if (status !== "active" || !csrfToken) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/student/projection", {
          method: "POST",
          headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
          body: "{}",
          signal: controller.signal
        });
        const data = await response.json() as StudentSourceProjection | { error?: { message?: string } };
        if (!response.ok || !("today" in data)) {
          throw new Error("error" in data ? data.error?.message : "Unable to organize your school sources.");
        }
        setProjection(data);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setProjectionError(caught instanceof Error ? caught.message : "Unable to organize your school sources.");
        }
      }
    })();
    return () => controller.abort();
  }, [csrfToken, status]);

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
      setCompletedPriorityIds((data.focusBlocks ?? []).map((item: { taskId: string }) => item.taskId));
      setReentry(data.reentry ?? null);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [csrfToken, status]);

  useEffect(() => {
    if (!plannerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [plannerOpen]);

  async function startStudentSession(targetView: StudentView = "today") {
    setView(targetView);
    if (status === "active") return;
    if (status === "starting") return;
    setStatus("starting");
    setError("");
    setProjectionError("");
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureKey: "emily_band_camp_v1", role: "student" })
      });
      const data = await response.json() as { csrfToken?: unknown } | { error?: { message?: string } };
      if (!response.ok || !("csrfToken" in data) || typeof data.csrfToken !== "string") {
        throw new Error(errorMessage(data));
      }
      setCsrfToken(data.csrfToken);
      setStatus("active");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Homeroom could not start yet.");
    }
  }

  function openView(nextView: StudentView) {
    if (status === "active") setView(nextView);
    else void startStudentSession(nextView);
  }

  function openLearningRoom(courseId: CourseId) {
    setSelectedPriority(null);
    setPlannerOpen(false);
    setLearningCourseId(courseId);
    setLearningRequestKey((current) => current + 1);
    setView("learn");
  }

  async function finishTask(result: StudentTaskRoomResult) {
    setCompletedPriorityIds((current) => current.includes(result.priorityId) ? current : [...current, result.priorityId]);
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
              disabled={!hydrated || status === "starting"}
              onClick={() => openView(tab.id)}
            ><span aria-hidden="true">{tab.icon}</span>{tab.label}</button>
          ))}
        </nav>
        <Link className={styles.identity} href="/" aria-label="Switch Homeroom profile"><span>E</span><div><strong>{student.name}</strong><small>Grade {student.grade} · switch</small></div></Link>
      </header>

      {status !== "active" ? (
        <section className={styles.welcome} aria-labelledby="student-welcome-title">
          <div className={styles.welcomeArt} aria-hidden="true">
            <span className={styles.sun} />
            <div className={styles.path}><i>1</i><span /><i>2</i><span /><i>3</i></div>
          </div>
          <p className={styles.eyebrow}>YOUR HOMEROOM</p>
          <h1 id="student-welcome-title">Hi {student.name}.</h1>
          <h2>Let’s make today feel smaller.</h2>
          <p>We’ll pick one thing, show the first step, and keep the rest out of the way.</p>
          <button type="button" onClick={() => startStudentSession("today")} disabled={!hydrated || status === "starting"}>
            {!hydrated ? "Loading Homeroom…" : status === "starting" ? "Connecting your school day…" : "Show me my first step"}<span aria-hidden="true">→</span>
          </button>
          <div className={styles.promise} aria-label="Three-step focus flow">
            <span><i>1</i><strong>Pick one</strong></span>
            <span><i>2</i><strong>Focus</strong></span>
            <span><i>3</i><strong>Feel done</strong></span>
          </div>
          <section className={styles.classPreview} aria-labelledby="class-preview-title">
            <div><p>STARTING GRADE {student.grade}</p><h3 id="class-preview-title">Grade {student.grade} summer readiness is ready.</h3></div>
            <p>Real class names appear only after a school source sync. Until then, Homeroom offers clearly labeled grade-based practice.</p>
            <button type="button" onClick={() => startStudentSession("learn")} disabled={!hydrated || status === "starting"}>Explore readiness <span aria-hidden="true">→</span></button>
          </section>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>
      ) : (
        <section className={styles.workspace}>
          {projectionError && <p className={styles.error} role="alert">{projectionError}</p>}
          {!projection && !projectionError && <section className={styles.loading} aria-live="polite">Connecting Classroom and calendar…</section>}

          {projection && view === "today" && (
            <div id="student-panel-today" role="tabpanel" aria-labelledby="student-tab-today">
              {reentry?.active && <p className={styles.completionNotice}><strong>{reentry.title}</strong> {reentry.message}</p>}
              {completedPriorityIds.length > 0 && <p className={styles.completionNotice}>✓ Focus block saved in Homeroom. Your school source remains unchanged until you submit there.</p>}
              <StudentPlanningBoardView
                projection={projection}
                view="today"
                onOpenTask={setSelectedPriority}
                onOpenPlanner={() => setPlannerOpen(true)}
                completedPriorityIds={completedPriorityIds}
              />
              <StudentFamilyAssist csrfToken={csrfToken} candidate={projection.guardianAssistCandidates?.[0] ?? null} />
            </div>
          )}
          {projection && view === "calendar" && (
            <div id="student-panel-calendar" role="tabpanel" aria-labelledby="student-tab-calendar">
              <StudentCalendar projection={projection} onOpenTask={setSelectedPriority} />
            </div>
          )}
          {projection && view === "classes" && (
            <div id="student-panel-classes" role="tabpanel" aria-labelledby="student-tab-classes">
              <StudentClasses projection={projection} onOpenLearning={openLearningRoom} onOpenTask={setSelectedPriority} />
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
        </section>
      )}

      {selectedPriority && (
        <StudentTaskRoom
          key={selectedPriority.id}
          priority={selectedPriority}
          onClose={() => setSelectedPriority(null)}
          onFinish={(result) => void finishTask(result)}
          onOpenLearning={openLearningRoom}
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
