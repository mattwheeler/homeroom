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
}

export function createTaskRoomState(priority: StudentTaskPriority): TaskRoomState {
  const timeboxMinutes = Math.max(1, priority.effort.recommendedTimeboxMinutes);
  return {
    selectedChunkId: priority.chunks[0]?.id ?? "",
    completedChunkIds: [],
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

export function StudentTaskRoomContent({
  priority,
  onClose,
  onFinish,
  onOpenLearning
}: StudentTaskRoomProps) {
  const [state, dispatch] = useReducer(taskRoomReducer, priority, createTaskRoomState);
  const [finished, setFinished] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const chunkIds = useMemo(() => priority.chunks.map((chunk) => chunk.id), [priority.chunks]);
  const completedCount = state.completedChunkIds.length;
  const allComplete = priority.chunks.length > 0 && completedCount === priority.chunks.length;
  const totalSeconds = state.timeboxMinutes * 60;
  const elapsedSeconds = Math.max(0, totalSeconds - state.remainingSeconds);
  const timeRemainingRatio = totalSeconds > 0 ? state.remainingSeconds / totalSeconds : 0;
  const selectedChunk = priority.chunks.find((chunk) => chunk.id === state.selectedChunkId)
    ?? priority.chunks[0]
    ?? null;

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
    if (!allComplete || finished) return;
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
              <p>{priority.priorityBand === "do_first" ? "DO FIRST" : priority.priorityBand === "plan_next" ? "PLAN NEXT" : "LATER"}</p>
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
                <p>FOCUS BLOCK COMPLETE</p>
                <h2>You worked through all {priority.chunks.length} chunks.</h2>
                <small>This progress is saved in Homeroom only. Nothing was submitted to {providerLabel(priority.source.provider)}.</small>
              </div>
              <button type="button" onClick={onClose}>Return to Today</button>
            </section>
          ) : (
            <div className={styles.layout}>
              <aside className={styles.focusRail} aria-label="Task progress and timer" data-testid="task-room-focus-rail">
                <section className={styles.progressCard}>
                  <div className={styles.sectionLabel}><span aria-hidden="true">✓</span><strong>Your progress</strong></div>
                  <strong>{completedCount} of {priority.chunks.length} chunks complete</strong>
                  <progress value={completedCount} max={Math.max(1, priority.chunks.length)}>
                    {completedCount} of {priority.chunks.length}
                  </progress>
                  <small>Check off one visible chunk at a time.</small>
                  <small>Your focus will be saved so Homeroom can help you return without judgment.</small>
                </section>

                <section className={styles.timerCard} aria-labelledby="task-timer-heading">
                  <div className={styles.timerRing} style={ringStyle}>
                    <span role="timer" aria-label={`${displayTimer(state.remainingSeconds)} remaining`}>
                      {displayTimer(state.remainingSeconds)}
                    </span>
                  </div>
                  <div>
                    <p id="task-timer-heading">Focus timebox</p>
                    <strong>{state.timerStatus === "running" ? "Stay with this chunk" : state.timerStatus === "paused" ? "Paused—your place is safe" : state.timerStatus === "elapsed" ? "Time is up—check your progress" : "Choose a short focus block"}</strong>
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

                <section className={styles.sourceCard}>
                  <p>Original source</p>
                  <strong>{providerLabel(priority.source.provider)}</strong>
                  <small>Homeroom never submits or changes this assignment.</small>
                  {priority.outbound?.available && (
                    <StudentOutboundGuard policy={priority.outbound.policy} resourceLabel="original assignment" />
                  )}
                </section>
              </aside>

              <section className={styles.workArea} data-testid="task-room-work-area">
                <section className={styles.directions} aria-labelledby="task-directions-heading">
                  <div>
                    <p>WHAT THIS ASSIGNMENT IS</p>
                    <h2 id="task-directions-heading">Directions</h2>
                    <strong>{priority.directions || (priority.outbound?.policy === "guardian_approval"
                      ? "The school source did not include written directions. Ask your guardian to help review the original assignment before you begin."
                      : "The school source did not include written directions. External source access is blocked, so pause and ask your guardian or teacher what to do next.")}</strong>
                  </div>
                  <ul aria-label="Why Homeroom recommended this assignment">
                    {priority.rationale.signals.map((signal) => <li key={signal}>{signal}</li>)}
                  </ul>
                </section>

                {selectedChunk && (
                  <section className={styles.nowCard} aria-live="polite">
                    <span>NOW</span>
                    <div>
                      <small>{selectedChunk.minutes}-minute chunk · {selectedChunk.skill.replace("_", " ")}</small>
                      <h2>{selectedChunk.label}</h2>
                      <p>{selectedChunk.action}</p>
                    </div>
                  </section>
                )}

                <section className={styles.chunkSection} aria-labelledby="task-chunks-heading">
                  <div className={styles.chunkHeading}>
                    <div>
                      <p>ORGANIZE THE WORK</p>
                      <h2 id="task-chunks-heading">Your {priority.chunks.length}-step checklist</h2>
                    </div>
                    <span>Choose a step to focus it</span>
                  </div>
                  <ol className={styles.chunkList}>
                    {priority.chunks.map((chunk) => {
                      const complete = state.completedChunkIds.includes(chunk.id);
                      const selected = state.selectedChunkId === chunk.id;
                      return (
                        <li
                          key={chunk.id}
                          className={`${complete ? styles.complete : ""} ${selected ? styles.selected : ""}`}
                          aria-current={selected ? "step" : undefined}
                        >
                          <button
                            className={styles.chunkSelect}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => dispatch({ type: "select_chunk", chunkId: chunk.id })}
                          >
                            <span>{complete ? "✓" : chunk.order}</span>
                            <div>
                              <small>{chunk.minutes} min · {chunk.skill.replace("_", " ")}</small>
                              <strong>{chunk.label}</strong>
                              <p>{chunk.action}</p>
                            </div>
                          </button>
                          <label>
                            <input
                              type="checkbox"
                              checked={complete}
                              onChange={() => toggleChunk(chunk.id)}
                            />
                            <span>{complete ? "Completed" : "Mark complete"}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ol>
                </section>

                <footer className={styles.actions}>
                  <div>
                    <strong>{allComplete ? "All chunks checked—nice follow-through." : `Finish ${priority.chunks.length - completedCount} more chunk${priority.chunks.length - completedCount === 1 ? "" : "s"} to complete this focus block.`}</strong>
                    <small>Completion stays in Homeroom. You still submit schoolwork in the school tool.</small>
                  </div>
                  <div>
                    {priority.course.trackCourseId && onOpenLearning && (
                      <button
                        className={styles.learningButton}
                        type="button"
                        onClick={() => onOpenLearning(priority.course.trackCourseId as CourseId)}
                      >Open a guided Learning session</button>
                    )}
                    <button className={styles.finishButton} type="button" disabled={!allComplete} onClick={finishTaskRoom}>
                      Finish focus block
                    </button>
                  </div>
                </footer>
              </section>
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
