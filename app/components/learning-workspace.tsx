"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import {
  getLearningTrack,
  type CourseId,
  type LearningTrack
} from "../../lib/domain/learning-tracks";
import {
  buildStudentSupportPolicy,
  emilyStudentSupportProfile
} from "../../lib/domain/student-support-profile";
import type {
  LearningDurationMinutes,
  SupportPreference
} from "../../lib/domain/learning-session";
import {
  LearningPriorityCard,
  LearningSessionRoadmap,
  LearningTimebox,
  SubjectVisualScaffold,
  TaskChunkOrganizer,
  type LearningPhase
} from "./learning-visual-tools";

interface Course {
  id: CourseId;
  name: string;
  mode?: "connected_class" | "grade_readiness";
  reason?: string;
}

interface LearningTurn {
  phase: "check_in" | "diagnostic" | "guided_practice" | "transfer" | "recap";
  message: string;
  question: string;
  encouragement: string;
  answerPolicy: "coach_not_complete";
  executiveSkill?: "time_management" | "organization" | "prioritization";
  nextAction?: string;
  visualScaffold?: {
    kind: "sequence" | "comparison" | "organizer" | "timeline" | "grid";
    title: string;
    items: Array<{ label: string; detail: string }>;
  };
}

interface StartLearningResponse {
  learningSession: {
    id: string;
    courseId: CourseId;
    durationMinutes: LearningDurationMinutes;
    targetEndsAt: string;
    turnCount: number;
    status: "active";
  };
  track: LearningTrack;
  turn: LearningTurn;
  timing: { targetEndsAt: string; remainingSeconds: number; phase: LearningTurn["phase"] };
  learnerContext: Array<{ id: string; statement: string; learnedAt: string }>;
  proof: { independentTrack: "learning"; goldenStateUnchanged: true; store: false };
}

interface LearningTurnResponse {
  learningSessionId: string;
  turnCount: number;
  turn: LearningTurn;
  timing: { targetEndsAt: string; remainingSeconds: number; phase: LearningTurn["phase"] };
  memoryUsed: string[];
  proof: { model: string; store: false };
}

interface LearnerContextResponse {
  signals: Array<{
    id: string;
    scopeCourseId: CourseId;
    statement: string;
    evidenceKind: "student_stated_preference";
    learnedAt: string;
  }>;
  progress: Array<{
    courseId: CourseId;
    objectiveId: string;
    status: "exploring" | "practicing";
    sessionsCompleted: number;
    nextReviewAt: string;
  }>;
  policy: {
    rawCompletedDialogueRetained: false;
    memoryIsVisibleAndDeletable: true;
    crossCourseContext: false;
  };
}

interface CompleteLearningResponse {
  completed: true;
  learningSessionId: string;
  summary: {
    courseName: string;
    missionTitle: string;
    objective: string;
    objectiveStatus: "exploring" | "practicing";
    completedTurns: number;
    sourceLabel: "Homeroom readiness mission";
    memoryStatement: string;
  };
  memory: { id: string; statement: string; why: string; canDelete: true };
  progress: { status: "exploring" | "practicing"; sessionsCompleted: number };
  proof: {
    activeDialogueDeleted: true;
    goldenStateUnchanged: true;
    goldenStateVersion: number;
  };
}

type Dialogue =
  | { role: "coach"; turn: LearningTurn }
  | { role: "student"; text: string };

const preferenceLabels: Record<SupportPreference, { icon: string; title: string; detail: string }> = {
  example_first: { icon: "▣", title: "Example first", detail: "Show one, then let me try." },
  questions_first: { icon: "?", title: "Questions first", detail: "Help me find my starting point." },
  mix_it_up: { icon: "↔", title: "Mix it up", detail: "Alternate examples and questions." }
};

const studentSupportPolicy = buildStudentSupportPolicy(emilyStudentSupportProfile);

function recommendationReason(course: Course): string {
  if (course.reason) return course.reason;
  const courseId = course.id;
  if (courseId === "course_band") return "Band camp is coming up";
  if (courseId === "course_algebra_1") return "Practice for upcoming Algebra work";
  if (courseId === "course_english_1") return "Get ready for your reading reflection";
  return "A short readiness practice for this class";
}

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object" || !("error" in value)) return fallback;
  const error = value.error;
  if (!error || typeof error !== "object" || !("message" in error)) return fallback;
  return typeof error.message === "string" ? error.message : fallback;
}

export function LearningWorkspace({
  courses,
  csrfToken,
  initialCourseId = null,
  grade = 9
}: {
  courses: readonly Course[];
  csrfToken: string;
  initialCourseId?: CourseId | null;
  grade?: number;
}) {
  const [selectedCourseId, setSelectedCourseId] = useState<CourseId | null>(initialCourseId);
  const [durationMinutes, setDurationMinutes] = useState<LearningDurationMinutes>(10);
  const [supportPreference, setSupportPreference] = useState<SupportPreference>("example_first");
  const [status, setStatus] = useState<"idle" | "starting" | "active" | "sending" | "completing" | "completed" | "error">("idle");
  const [active, setActive] = useState<StartLearningResponse | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue[]>([]);
  const [responseText, setResponseText] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [context, setContext] = useState<LearnerContextResponse | null>(null);
  const [completion, setCompletion] = useState<CompleteLearningResponse | null>(null);
  const [deletedSignals, setDeletedSignals] = useState<string[]>([]);
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [error, setError] = useState("");
  const roomRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const selectedTrack = useMemo(
    () => selectedCourseId ? getLearningTrack(selectedCourseId) : null,
    [selectedCourseId]
  );
  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? null,
    [courses, selectedCourseId]
  );
  const recommendedCourses = useMemo(() => {
    const preferredOrder: CourseId[] = ["course_band", "course_algebra_1", "course_english_1"];
    return [...courses].sort((left, right) => {
      const leftRank = preferredOrder.indexOf(left.id);
      const rightRank = preferredOrder.indexOf(right.id);
      return (leftRank === -1 ? 99 : leftRank) - (rightRank === -1 ? 99 : rightRank);
    });
  }, [courses]);
  const visibleCourses = showAllCourses
    ? recommendedCourses
    : recommendedCourses.slice(0, studentSupportPolicy.attentionSupport.classChoicesBeforeExpand);
  const gradeReadinessMode = courses.length > 0 && courses.every((course) => course.mode === "grade_readiness");
  const sessionInProgress = Boolean(
    active && (status === "active" || status === "sending" || status === "completing")
  );
  const roomLocked = status === "starting" || sessionInProgress;
  const latestCoachTurn = useMemo(
    () => [...dialogue].reverse().find((entry) => entry.role === "coach")?.turn ?? active?.turn ?? null,
    [active, dialogue]
  );
  const currentPhase: LearningPhase = completion ? "recap" : latestCoachTurn?.phase ?? "check_in";

  useEffect(() => {
    if (!selectedCourseId) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => roomRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [selectedCourseId]);

  useEffect(() => {
    if (!selectedCourseId) return;
    const handleRoomKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !roomLocked) {
        setSelectedCourseId(null);
        return;
      }
      if (event.key !== "Tab" || !roomRef.current) return;
      const focusable = Array.from(roomRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
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
    window.addEventListener("keydown", handleRoomKeyboard);
    return () => window.removeEventListener("keydown", handleRoomKeyboard);
  }, [roomLocked, selectedCourseId]);

  useEffect(() => {
    if (!active || (status !== "active" && status !== "sending" && status !== "completing")) return;
    const update = () => {
      const serverRemaining = Math.ceil(
        (Date.parse(active.learningSession.targetEndsAt) - Date.now()) / 1_000
      );
      setRemainingSeconds(
        Math.max(0, Math.min(active.learningSession.durationMinutes * 60, serverRemaining))
      );
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [active, status]);

  async function loadContext(courseId: CourseId) {
    if (!csrfToken) return;
    try {
      const response = await fetch("/api/learning/context", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ courseId })
      });
      const data = await response.json() as LearnerContextResponse | { error?: { message?: string } };
      if (response.ok && "signals" in data) setContext(data);
    } catch {
      // Prior context is helpful but does not block a new session.
    }
  }

  function selectTrack(courseId: CourseId) {
    if (roomLocked) return;
    setSelectedCourseId(courseId);
    setStatus("idle");
    setActive(null);
    setDialogue([]);
    setCompletion(null);
    setError("");
    void loadContext(courseId);
  }

  function closeRoom() {
    if (roomLocked) return;
    setSelectedCourseId(null);
  }

  async function startLearning() {
    if (!csrfToken || !selectedCourseId) return;
    setStatus("starting");
    setError("");
    try {
      const response = await fetch("/api/learning/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ courseId: selectedCourseId, durationMinutes, supportPreference })
      });
      const data = await response.json() as StartLearningResponse | { error?: { message?: string } };
      if (!response.ok || !("learningSession" in data)) {
        throw new Error(errorMessage(data, "Unable to start this Learning session."));
      }
      setActive(data);
      setDialogue([{ role: "coach", turn: data.turn }]);
      setRemainingSeconds(data.timing.remainingSeconds);
      setStatus("active");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start this Learning session.");
      setStatus("error");
    }
  }

  async function sendResponse(event: FormEvent) {
    event.preventDefault();
    const studentResponse = responseText.trim();
    if (!csrfToken || !active || !studentResponse || status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      const response = await fetch("/api/learning/turn", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({
          learningSessionId: active.learningSession.id,
          response: studentResponse
        })
      });
      const data = await response.json() as LearningTurnResponse | { error?: { message?: string } };
      if (!response.ok || !("turn" in data)) {
        throw new Error(errorMessage(data, "The coach could not continue yet."));
      }
      setDialogue((current) => [
        ...current,
        { role: "student", text: studentResponse },
        { role: "coach", turn: data.turn }
      ]);
      setActive((current) => current ? {
        ...current,
        learningSession: { ...current.learningSession, turnCount: data.turnCount }
      } : current);
      setRemainingSeconds(data.timing.remainingSeconds);
      setResponseText("");
      setStatus("active");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The coach could not continue yet.");
      setStatus("active");
    }
  }

  async function completeSession() {
    if (!csrfToken || !active) return;
    setStatus("completing");
    setError("");
    try {
      const response = await fetch("/api/learning/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ learningSessionId: active.learningSession.id })
      });
      const data = await response.json() as CompleteLearningResponse | { error?: { message?: string } };
      if (!response.ok || !("completed" in data)) {
        throw new Error(errorMessage(data, "Unable to save the Learning recap."));
      }
      setCompletion(data);
      setDialogue([]);
      setStatus("completed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the Learning recap.");
      setStatus("active");
    }
  }

  async function deleteSignal(signalId: string) {
    if (!csrfToken) return;
    const response = await fetch("/api/learning/context/delete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
      body: JSON.stringify({ signalId })
    });
    if (response.ok) setDeletedSignals((current) => [...current, signalId]);
  }

  const visibleSignals = [
    ...(completion ? [completion.memory] : []),
    ...(context?.signals ?? []).map((signal) => ({
      id: signal.id,
      statement: signal.statement,
      why: "Saved from an earlier student-selected Learning preference."
    }))
  ].filter(
    (signal, index, all) =>
      !deletedSignals.includes(signal.id) &&
      all.findIndex((candidate) => candidate.statement === signal.statement) === index
  );

  return (
    <section className="learning-workspace card" id="learning" aria-labelledby="learning-title">
      <header className="learning-header">
        <div>
          <p className="eyebrow">{gradeReadinessMode ? `GRADE ${grade} SUMMER READINESS` : "LEARN · Recommended first"}</p>
          <h2 id="learning-title">{gradeReadinessMode ? "Choose a short summer practice" : "Pick one short practice room"}</h2>
          <p>{gradeReadinessMode
            ? `Your school classes aren’t synced yet. These are Homeroom-created Grade ${grade} readiness rooms—not teacher assignments.`
            : "Three useful choices are shown first. Every connected class is still available when you want it."}</p>
        </div>
        <span className="learning-trust">Private by default · no grades</span>
      </header>

      <div className="learning-taxonomy" aria-label="How Learning rooms are created">
        <span><i aria-hidden="true">G</i><strong>From school</strong><small>Shown only when class names or due-work signals come from a connected source.</small></span>
        <span><i aria-hidden="true">◇</i><strong>Readiness practice</strong><small>Homeroom-created coaching—not a teacher assignment or grade.</small></span>
        <span><i aria-hidden="true">◷</i><strong>Life skills</strong><small>Time management, organization, and prioritization are built in.</small></span>
      </div>

      <div className="learning-track-grid">
        {visibleCourses.map((course) => {
          const track = getLearningTrack(course.id);
          return (
            <button
              key={course.id}
              className={`learning-track-button ${selectedCourseId === course.id ? "selected" : ""}`}
              aria-label={`Open ${course.name} learning track`}
              aria-pressed={selectedCourseId === course.id}
              disabled={sessionInProgress && selectedCourseId !== course.id}
              onClick={() => selectTrack(course.id)}
            >
              <span>{course.name}</span>
              <div className="learning-origin-row">
                {course.mode === "connected_class" && <span>From school</span>}
                <span>Readiness practice</span>
              </div>
              <strong>{track.mission.title}</strong>
              <em><b>Why this is here:</b> {recommendationReason(course)}</em>
              <small>{track.mission.suggestedMinutes} min · Life skills built in</small>
            </button>
          );
        })}
      </div>
      {courses.length > studentSupportPolicy.attentionSupport.classChoicesBeforeExpand && (
        <button className="learning-show-all" type="button" aria-expanded={showAllCourses} onClick={() => setShowAllCourses((current) => !current)}>
          {showAllCourses ? "Show recommended only" : `Show all ${courses.length} ${gradeReadinessMode ? "options" : "classes"}`}
        </button>
      )}

      {selectedTrack && selectedCourse && typeof document !== "undefined" && createPortal(
        <div className="learning-room-overlay">
          <section
            className="learning-room"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedCourse.name} Learning Room`}
            ref={roomRef}
            tabIndex={-1}
          >
            <header className="learning-room-bar">
              <button type="button" disabled={roomLocked} onClick={closeRoom}>
                <span aria-hidden="true">←</span> Back to classes
              </button>
              <div>
                <span>Focused Learning Room</span>
                <strong>{selectedCourse.name}</strong>
              </div>
              <div className="learning-room-fit">
                <strong>Grade {emilyStudentSupportProfile.grade}</strong>
                <small>{studentSupportPolicy.visualFirst ? "Visual-first" : "Multi-modal"} · up to {studentSupportPolicy.maxDirectionsAtOnce} steps</small>
              </div>
            </header>
            <section className="learning-stage" aria-live="polite">
              <header className="learning-stage-heading">
                <div>
                  <span className="source-chip">Readiness practice · {selectedTrack.mission.source.label}</span>
                  <h3>{selectedTrack.trackTitle}</h3>
                  <p>A guided workspace for planning, seeing, practicing, and explaining—not a one-question quiz.</p>
                </div>
                <span className="learning-safety-note">Student thinking stays in the lead</span>
              </header>

              <div className="learning-goal-row">
                <LearningPriorityCard
                  courseName={selectedCourse.name}
                  missionTitle={selectedTrack.mission.title}
                  objective={selectedTrack.mission.objective}
                  nextAction={latestCoachTurn?.nextAction}
                />
                <LearningTimebox
                  durationMinutes={durationMinutes}
                  remainingSeconds={remainingSeconds}
                  active={sessionInProgress}
                />
              </div>

              <div className="learning-focus-layout">
                <aside className="learning-session-tools" aria-label="Session planning tools">
                  <LearningSessionRoadmap phase={currentPhase} completed={status === "completed"} />
                  <TaskChunkOrganizer
                    phase={currentPhase}
                    completed={status === "completed"}
                    nextAction={latestCoachTurn?.nextAction}
                  />
                </aside>

                <main className="learning-session-work">
                  <SubjectVisualScaffold
                    coachMode={selectedTrack.coachMode}
                    courseName={selectedCourse.name}
                    phase={currentPhase}
                    visualScaffold={latestCoachTurn?.visualScaffold}
                  />

                  {(status === "idle" || status === "error" || status === "starting") && !completion && (
                    <section className="learning-setup" aria-labelledby="learning-setup-title">
                      <div className="learning-setup-heading">
                        <p className="learning-micro-label">READY WHEN YOU ARE</p>
                        <h4 id="learning-setup-title">Start with your saved learning setup</h4>
                        <p>{durationMinutes} minutes · {preferenceLabels[supportPreference].title}. You can change either setting when you need to.</p>
                      </div>
                      <button
                        className="learning-start-button"
                        disabled={status === "starting"}
                        onClick={startLearning}
                      >
                        <span aria-hidden="true">▶</span>
                        {status === "starting" ? "Opening live coach…" : `Start ${durationMinutes}-minute session`}
                      </button>
                      <details className="learning-setup-options">
                        <summary>Change session setup</summary>
                        <div>
                          <fieldset>
                            <legend>Session length</legend>
                            <div className="learning-choice-row">
                              {([10, 15, 20] as const).map((duration) => (
                                <button
                                  key={duration}
                                  type="button"
                                  aria-pressed={durationMinutes === duration}
                                  onClick={() => setDurationMinutes(duration)}
                                ><strong>{duration}</strong><small>minutes</small></button>
                              ))}
                            </div>
                          </fieldset>
                          <fieldset>
                            <legend>How Homeroom should begin</legend>
                            <div className="learning-preferences">
                              {(Object.keys(preferenceLabels) as SupportPreference[]).map((preference) => (
                                <label key={preference} className={supportPreference === preference ? "selected" : ""}>
                                  <input
                                    type="radio"
                                    name="support-preference"
                                    value={preference}
                                    checked={supportPreference === preference}
                                    onChange={() => setSupportPreference(preference)}
                                  />
                                  <i aria-hidden="true">{preferenceLabels[preference].icon}</i>
                                  <span><strong>{preferenceLabels[preference].title}</strong><small>{preferenceLabels[preference].detail}</small></span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        </div>
                      </details>
                    </section>
                  )}

                  {(status === "active" || status === "sending" || status === "completing") && active && (
                    <section className="learning-live" aria-labelledby="learning-coach-title">
                      <div className="learning-live-proof">
                        <span id="learning-coach-title"><i /> Live GPT-5.6 Sol coach</span>
                        <small>App-owned context · OpenAI store: false</small>
                      </div>
                      {latestCoachTurn?.executiveSkill && (
                        <div className={`learning-executive-cue ${latestCoachTurn.executiveSkill}`}>
                          <span aria-hidden="true">
                            {latestCoachTurn.executiveSkill === "time_management" ? "◷" : latestCoachTurn.executiveSkill === "organization" ? "▦" : "①"}
                          </span>
                          <div>
                            <small>Skill you are practicing</small>
                            <strong>{latestCoachTurn.executiveSkill.replace("_", " ")}</strong>
                          </div>
                        </div>
                      )}
                      <div className="learning-dialogue" aria-label="Conversation with Homeroom">
                        {dialogue.map((entry, index) => entry.role === "student" ? (
                          <div className="learning-bubble student" key={`student-${index}`}>
                            <span>Emily</span><p>{entry.text}</p>
                          </div>
                        ) : (
                          <div className="learning-bubble coach" key={`coach-${index}`}>
                            <span>Homeroom · {entry.turn.phase.replace("_", " ")}</span>
                            <p>{entry.turn.message}</p>
                            <strong>{entry.turn.question}</strong>
                            <small>{entry.turn.encouragement}</small>
                          </div>
                        ))}
                      </div>
                      <form className="learning-response" onSubmit={sendResponse}>
                        <label htmlFor="learning-response">Your thinking</label>
                        <div>
                          <textarea
                            id="learning-response"
                            aria-label="Your response to Homeroom"
                            maxLength={500}
                            value={responseText}
                            disabled={status !== "active"}
                            onChange={(event) => setResponseText(event.target.value)}
                            placeholder="Explain what you notice or what step you would try next."
                          />
                          <button disabled={!responseText.trim() || status !== "active"} type="submit">
                            {status === "sending" ? "Coach is thinking…" : "Share my thinking"}
                          </button>
                        </div>
                      </form>
                      <div className="learning-session-actions">
                        <span>The clock guides the pace. You can end anytime.</span>
                        <button disabled={status === "completing" || status === "sending"} onClick={completeSession}>
                          {status === "completing" ? "Saving recap…" : "End and save session"}
                        </button>
                      </div>
                    </section>
                  )}

                  {completion && status === "completed" && (
                    <div className="learning-complete">
                      <span className="learning-complete-mark">✓</span>
                      <div>
                        <p className="eyebrow">SESSION SAVED · {completion.summary.objectiveStatus}</p>
                        <h4>{completion.summary.missionTitle}</h4>
                        <p>{completion.summary.objective}</p>
                        <small>{completion.summary.completedTurns} student turn{completion.summary.completedTurns === 1 ? "" : "s"} · Private Learning notes saved</small>
                      </div>
                      <div className="dialogue-deleted"><strong>Active dialogue deleted</strong><span>Only the recap and explicit preference remain.</span></div>
                    </div>
                  )}

                  {error && <p className="learning-error" role="alert">{error}</p>}

                  {visibleSignals.length > 0 && (
                    <aside className="learner-memory" aria-labelledby="learner-memory-title">
                      <div>
                        <p className="eyebrow">VISIBLE · EDITABLE · COURSE-SCOPED</p>
                        <h4 id="learner-memory-title">What Homeroom remembers</h4>
                      </div>
                      <div className="memory-list">
                        {visibleSignals.map((signal) => (
                          <article key={signal.id}>
                            <div><strong>{signal.statement}</strong><small>{signal.why}</small></div>
                            <button onClick={() => void deleteSignal(signal.id)}>Delete</button>
                          </article>
                        ))}
                      </div>
                    </aside>
                  )}
                </main>
              </div>
            </section>
          </section>
        </div>,
        document.body
      )}
    </section>
  );
}
