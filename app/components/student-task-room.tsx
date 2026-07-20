"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { createPortal } from "react-dom";

import type { CourseId } from "../../lib/domain/learning-tracks";
import type { StudentSourceProjection } from "../../lib/domain/student-source-projection";
import { buildTaskSessionPlan } from "../../lib/domain/task-session-plan";
import type { FocusBlockRecord } from "../../lib/storage/focus-block-store";
import styles from "./student-task-room.module.css";
import { StudentOutboundGuard } from "./student-outbound-guard";

export type StudentTaskPriority = StudentSourceProjection["priorities"][number];

type TimerStatus = "idle" | "running" | "paused" | "elapsed";

export interface TaskRoomState {
  selectedChunkId: string;
  completedChunkIds: string[];
  timeboxMinutes: number;
  remainingSeconds: number;
  timerStatus: TimerStatus;
}

export type TaskRoomAction =
  | { type: "select_chunk"; chunkId: string }
  | { type: "toggle_chunk"; chunkId: string; orderedChunkIds: string[] }
  | { type: "set_timebox"; minutes: number }
  | { type: "start_timer" }
  | { type: "pause_timer" }
  | { type: "reset_timer" }
  | { type: "tick" };

export interface StudentTaskRoomResult {
  priorityId: string;
  completedChunkIds: string[];
  selectedTimeboxMinutes: number;
  elapsedSeconds: number;
  source: StudentTaskPriority["source"];
}

export interface StudentTaskRoomProps {
  priority: StudentTaskPriority;
  onClose: () => void;
  onFinish?: (result: StudentTaskRoomResult) => void;
  onOpenLearning?: (courseId: CourseId) => void;
  previousSessions?: readonly FocusBlockRecord[];
  resumeSession?: FocusBlockRecord | null;
}

function planFor(priority: StudentTaskPriority, selectedMinutes: number) {
  return buildTaskSessionPlan({
    externalId: priority.source.externalId,
    title: priority.title,
    directions: priority.directions,
    taskKind: priority.sessionPlan?.kind,
    selectedMinutes,
    maxSteps: priority.sessionPlan?.maxSteps ?? Math.max(2, priority.chunks.length)
  });
}

export function createTaskRoomState(
  priority: StudentTaskPriority,
  resumeSession?: FocusBlockRecord | null
): TaskRoomState {
  const timeboxMinutes = Math.max(
    1,
    resumeSession?.selectedMinutes ?? priority.effort.recommendedTimeboxMinutes
  );
  const plan = planFor(priority, timeboxMinutes);
  const visibleIds = new Set(plan.steps.map((step) => step.id));
  const completedChunkIds = (resumeSession?.completedChunkIds ?? []).filter((id) => visibleIds.has(id));
  return {
    selectedChunkId: plan.steps.find((step) => !completedChunkIds.includes(step.id))?.id
      ?? plan.steps[0]?.id
      ?? "",
    completedChunkIds,
    timeboxMinutes,
    remainingSeconds: timeboxMinutes * 60,
    timerStatus: "idle"
  };
}

export function taskRoomReducer(state: TaskRoomState, action: TaskRoomAction): TaskRoomState {
  if (action.type === "select_chunk") {
    return { ...state, selectedChunkId: action.chunkId };
  }
  if (action.type === "toggle_chunk") {
    const wasCompleted = state.completedChunkIds.includes(action.chunkId);
    const completedChunkIds = wasCompleted
      ? state.completedChunkIds.filter((id) => id !== action.chunkId)
      : [...state.completedChunkIds, action.chunkId];
    const nextIncomplete = action.orderedChunkIds.find((id) => !completedChunkIds.includes(id));
    return {
      ...state,
      completedChunkIds,
      selectedChunkId: wasCompleted ? action.chunkId : nextIncomplete ?? action.chunkId
    };
  }
  if (action.type === "set_timebox") {
    if (state.timerStatus === "running") return state;
    const minutes = Math.max(1, Math.min(60, Math.floor(action.minutes)));
    return {
      ...state,
      timeboxMinutes: minutes,
      remainingSeconds: minutes * 60,
      timerStatus: "idle"
    };
  }
  if (action.type === "start_timer") {
    if (state.timerStatus === "running") return state;
    if (state.remainingSeconds === 0) {
      return {
        ...state,
        remainingSeconds: state.timeboxMinutes * 60,
        timerStatus: "running"
      };
    }
    return { ...state, timerStatus: "running" };
  }
  if (action.type === "pause_timer") {
    return state.timerStatus === "running" ? { ...state, timerStatus: "paused" } : state;
  }
  if (action.type === "reset_timer") {
    return {
      ...state,
      remainingSeconds: state.timeboxMinutes * 60,
      timerStatus: "idle"
    };
  }
  if (state.timerStatus !== "running") return state;
  const remainingSeconds = Math.max(0, state.remainingSeconds - 1);
  return {
    ...state,
    remainingSeconds,
    timerStatus: remainingSeconds === 0 ? "elapsed" : "running"
  };
}

function providerLabel(provider: StudentTaskPriority["source"]["provider"]): string {
  return provider === "google_classroom" ? "Google Classroom" : "BAND calendar";
}

function dueLabel(priority: StudentTaskPriority): string {
  if (!priority.due) return "No due date";
  const [year, month, day] = priority.due.date.split("-").map(Number);
  const date = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, day)))
    : priority.due.date;
  if (!priority.due.time) return `Due ${date}`;
  const [hourValue, minute = "00"] = priority.due.time.split(":");
  const hour = Number(hourValue);
  if (!Number.isFinite(hour)) return `Due ${date}`;
  return `Due ${date} at ${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function displayTimer(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function timeboxOptions(recommendedMinutes: number): number[] {
  return [...new Set([10, 15, 20, recommendedMinutes])]
    .filter((minutes) => minutes > 0 && minutes <= 60)
    .sort((left, right) => left - right);
}

function timerButtonLabel(status: TimerStatus): string {
  if (status === "running") return "Pause timer";
  if (status === "paused") return "Resume timer";
  if (status === "elapsed") return "Restart timer";
  return "Start focus timer";
}

function sourcedChecklistItems(directions: string): string[] {
  const sourceText = directions
    .replace(/^.*?\b(?:pack|confirm|bring|gather)\b\s*/i, "")
    .replace(/[.!?]+$/, "");
  const items = sourceText
    .split(/,\s*|\s+and\s+/i)
    .map((item) => item.replace(/^and\s+/i, "").trim())
    .filter((item) => item.length >= 2 && item.length <= 80);
  return items.length >= 2 ? items.slice(0, 10) : [directions];
}

function PrivateWorkSurface({ kind, directions }: { kind: string; directions: string }) {
  const [draft, setDraft] = useState("");
  const [readyItems, setReadyItems] = useState<string[]>([]);
  const checklist = useMemo(() => sourcedChecklistItems(directions), [directions]);
  if (kind === "checklist_preparation") {
    return (
      <section className={styles.privateWork} aria-labelledby="private-work-title">
        <div><p>My private work</p><h3 id="private-work-title">Check what is ready</h3><span>These checkmarks stay in this browser session.</span></div>
        <ul>
          {checklist.map((item) => (
            <li key={item}>
              <label><input type="checkbox" checked={readyItems.includes(item)} onChange={() => setReadyItems((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])} /><span>{item}</span></label>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const label = kind === "writing"
    ? "Draft this step"
    : kind === "math_problem_set"
      ? "Scratch work"
      : kind === "vocabulary"
        ? "Words I’m working with"
        : "Notes for this step";
  return (
    <section className={styles.privateWork} aria-labelledby="private-work-title">
      <div><p>My private work</p><h3 id="private-work-title">{label}</h3><span>This stays in this browser session. It is not shared with your guardian.</span></div>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1200} aria-label={label} placeholder="Start with one small part…" />
    </section>
  );
}

export function StudentTaskRoomContent({
  priority,
  onClose,
  onFinish,
  onOpenLearning,
  previousSessions = [],
  resumeSession = null
}: StudentTaskRoomProps) {
  const [state, dispatch] = useReducer(
    taskRoomReducer,
    { priority, resumeSession },
    ({ priority: initialPriority, resumeSession: initialResume }) => createTaskRoomState(initialPriority, initialResume)
  );
  const [finished, setFinished] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const sessionPlan = useMemo(
    () => planFor(priority, state.timeboxMinutes),
    [priority, state.timeboxMinutes]
  );
  const chunks = sessionPlan.steps;
  const currentChunk = chunks.find((chunk) => chunk.id === state.selectedChunkId) ?? chunks[0];
  const chunkIds = useMemo(() => chunks.map((chunk) => chunk.id), [chunks]);
  const completedCount = state.completedChunkIds.length;
  const allComplete = chunks.length > 0 && completedCount === chunks.length;
  const canEndSession = completedCount > 0;
  const totalSeconds = state.timeboxMinutes * 60;
  const elapsedSeconds = Math.max(0, totalSeconds - state.remainingSeconds);
  const timeRemainingRatio = totalSeconds > 0 ? state.remainingSeconds / totalSeconds : 0;

  useEffect(() => {
    if (state.timerStatus !== "running") return;
    const timer = window.setInterval(() => dispatch({ type: "tick" }), 1_000);
    return () => window.clearInterval(timer);
  }, [state.timerStatus]);

  useEffect(() => {
    priorFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      priorFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [onClose]);

  function toggleChunk(chunkId: string) {
    if (finished) return;
    dispatch({ type: "toggle_chunk", chunkId, orderedChunkIds: chunkIds });
  }

  function toggleTimer() {
    dispatch({ type: state.timerStatus === "running" ? "pause_timer" : "start_timer" });
  }

  function finishTaskRoom() {
    if (!canEndSession || finished) return;
    if (state.timerStatus === "running") dispatch({ type: "pause_timer" });
    setFinished(true);
    onFinish?.({
      priorityId: priority.id,
      completedChunkIds: [...state.completedChunkIds],
      selectedTimeboxMinutes: state.timeboxMinutes,
      elapsedSeconds,
      source: priority.source
    });
  }

  const ringStyle = {
    "--task-time-remaining": `${timeRemainingRatio * 360}deg`
  } as CSSProperties;

  return (
    <section
      className={styles.room}
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-task-room-title"
      ref={dialogRef}
      tabIndex={-1}
    >
      <header className={styles.topbar}>
        <button className={styles.closeButton} type="button" onClick={onClose}>
          <span aria-hidden="true">←</span> Close workroom
        </button>
        <div>
          <span>Focused task room</span>
          <strong>{priority.course.name}</strong>
        </div>
        <span className={styles.readOnly}>From {providerLabel(priority.source.provider)}</span>
      </header>

      <div className={styles.scrollArea}>
        <main className={styles.content}>
          <header className={styles.hero}>
            <div className={`${styles.rank} ${styles[priority.urgency.visualToken]}`} aria-label={`Priority ${priority.rank}`}>
              {priority.rank}
            </div>
            <div>
              <p>{priority.priorityBand === "do_first" ? "TODAY" : priority.priorityBand === "plan_next" ? "COMING UP" : "LATER"}</p>
              <h1 id="student-task-room-title">{priority.title}</h1>
              <div className={styles.evidence} aria-label="Task evidence">
                <span>{priority.course.name}</span>
                <span>{dueLabel(priority)}</span>
                <span>{priority.urgency.label}</span>
                <span>{providerLabel(priority.source.provider)}</span>
              </div>
            </div>
          </header>

          {finished ? (
            <section className={styles.finished} aria-live="polite">
              <span aria-hidden="true">✓</span>
              <div>
                <p>FOCUS SESSION SAVED</p>
                <h2>You worked through {completedCount} of {chunks.length} steps.</h2>
                <small>Your place is saved in Homeroom. This does not mark the assignment complete or submit anything to {providerLabel(priority.source.provider)}.</small>
              </div>
              <button type="button" onClick={onClose}>Return to Today</button>
            </section>
          ) : (
            <div className={styles.layout}>
              <section className={styles.workArea} data-testid="task-room-work-area">
                {currentChunk && (
                  <section className={styles.currentStep} aria-labelledby="current-step-title">
                    <header>
                      <div className={styles.currentBadge}><span>NOW</span><strong>{currentChunk.order}</strong></div>
                      <div><p>CURRENT STEP · {currentChunk.minutes} MIN</p><h2 id="current-step-title">{currentChunk.label}</h2><span>{currentChunk.action}</span></div>
                    </header>
                    <PrivateWorkSurface kind={sessionPlan.kind} directions={priority.directions ?? ""} />
                    <footer>
                      <label>
                        <input type="checkbox" checked={state.completedChunkIds.includes(currentChunk.id)} onChange={() => toggleChunk(currentChunk.id)} />
                        <span>{state.completedChunkIds.includes(currentChunk.id) ? "Step complete" : "Mark this step complete"}</span>
                      </label>
                      {priority.course.trackCourseId && onOpenLearning && (
                        <button className={styles.contextHelp} type="button" onClick={() => onOpenLearning(priority.course.trackCourseId as CourseId)}>Need a lesson on this?</button>
                      )}
                    </footer>
                  </section>
                )}

                <details className={styles.planOverview}>
                  <summary><span><strong>See the full plan</strong><small>{completedCount} of {chunks.length} steps complete</small></span><span aria-hidden="true">⌄</span></summary>
                  <ol className={styles.chunkList}>
                    {chunks.map((chunk) => {
                      const complete = state.completedChunkIds.includes(chunk.id);
                      const selected = state.selectedChunkId === chunk.id;
                      return (
                        <li key={chunk.id} className={`${complete ? styles.complete : ""} ${selected ? styles.selected : ""}`} aria-current={selected ? "step" : undefined}>
                          <button className={styles.chunkSelect} type="button" aria-pressed={selected} onClick={() => dispatch({ type: "select_chunk", chunkId: chunk.id })}>
                            <span>{complete ? "✓" : chunk.order}</span>
                            <div><small>{chunk.minutes} min · {chunk.skill.replace("_", " ")}</small><strong>{chunk.label}</strong><p>{chunk.action}</p></div>
                          </button>
                          <label><input type="checkbox" checked={complete} onChange={() => toggleChunk(chunk.id)} /><span>{complete ? "Completed" : "Mark complete"}</span></label>
                        </li>
                      );
                    })}
                  </ol>
                </details>

                <details className={styles.assignmentDetails}>
                  <summary><strong>Assignment details</strong><span>{providerLabel(priority.source.provider)} · {dueLabel(priority)}</span></summary>
                  <div className={styles.directions}>
                    <div><p>ASSIGNMENT</p><h2>Directions</h2><strong>{priority.directions || (priority.outbound?.policy === "guardian_approval" ? "The school source did not include written directions. Ask your guardian to help review the original assignment before you begin." : "The school source did not include written directions. External source access is blocked, so pause and ask your guardian or teacher what to do next.")}</strong></div>
                    <ul aria-label="Why Homeroom recommended this assignment">{priority.rationale.signals.map((signal) => <li key={signal}>{signal}</li>)}</ul>
                  </div>
                  <div className={styles.sourceDetail}><strong>Original source: {providerLabel(priority.source.provider)}</strong><span>Homeroom never submits or changes this assignment.</span>{priority.outbound?.available && <StudentOutboundGuard policy={priority.outbound.policy} resourceLabel="original assignment" />}</div>
                </details>

                <footer className={styles.actions}>
                  <div><strong>{allComplete ? "All session steps are checked." : canEndSession ? "Your place is ready to save." : "Complete one visible step before saving this session."}</strong><small>This saves Homeroom progress only. The school source still controls assignment status.</small></div>
                  <button className={styles.finishButton} type="button" disabled={!canEndSession} onClick={finishTaskRoom}>{allComplete ? "Save finished session" : "Pause and save"}</button>
                </footer>
              </section>

              <aside className={styles.focusRail} aria-label="Task progress and timer" data-testid="task-room-focus-rail">
                <section className={styles.progressCard}>
                  <div className={styles.sectionLabel}><span aria-hidden="true">✓</span><strong>Your progress</strong></div>
                  <strong>{completedCount} of {chunks.length} steps complete</strong>
                  <progress value={completedCount} max={Math.max(1, chunks.length)}>{completedCount} of {chunks.length}</progress>
                  <small>Your session will be saved when you end it.</small>
                </section>
                <section className={styles.timerCard} aria-labelledby="task-timer-heading">
                  <div className={styles.timerRing} style={ringStyle}>
                    <span role="timer" aria-label={`${displayTimer(state.remainingSeconds)} remaining`}>
                      {displayTimer(state.remainingSeconds)}
                    </span>
                  </div>
                  <div>
                    <p id="task-timer-heading">Focus timebox</p>
                    <strong>{state.timerStatus === "running" ? "Stay with this chunk" : state.timerStatus === "paused" ? "Paused. Resume when ready." : state.timerStatus === "elapsed" ? "Time is up—check your progress" : "Choose a short focus block"}</strong>
                  </div>
                  <div className={styles.timeChoices} aria-label="Choose timebox length">
                    {timeboxOptions(priority.effort.recommendedTimeboxMinutes).map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        aria-pressed={state.timeboxMinutes === minutes}
                        disabled={state.timerStatus === "running"}
                        onClick={() => dispatch({ type: "set_timebox", minutes })}
                      >{minutes} min</button>
                    ))}
                  </div>
                  <button className={styles.timerButton} type="button" onClick={toggleTimer}>
                    {timerButtonLabel(state.timerStatus)}
                  </button>
                  {(state.timerStatus === "paused" || state.timerStatus === "elapsed") && (
                    <button className={styles.resetButton} type="button" onClick={() => dispatch({ type: "reset_timer" })}>
                      Reset timebox
                    </button>
                  )}
                </section>
                {previousSessions.length > 0 && (
                  <details className={styles.historyCard}>
                    <summary>Previous sessions</summary>
                    <ul>{previousSessions.slice(0, 3).map((session) => <li key={session.id}><strong>{Math.max(1, Math.round(session.elapsedSeconds / 60))} min worked</strong><span>{session.completedChunkCount} of {session.plannedChunkCount} steps · {session.sourceStatus}</span></li>)}</ul>
                  </details>
                )}
              </aside>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

export function StudentTaskRoom(props: StudentTaskRoomProps) {
  if (typeof document === "undefined") return null;
  return createPortal(<StudentTaskRoomContent {...props} />, document.body);
}
