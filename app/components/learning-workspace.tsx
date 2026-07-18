"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  getLearningTrack,
  type CourseId,
  type LearningTrack
} from "../../lib/domain/learning-tracks";
import type {
  LearningDurationMinutes,
  SupportPreference
} from "../../lib/domain/learning-session";

interface Course {
  id: CourseId;
  name: string;
}

interface LearningTurn {
  phase: "check_in" | "diagnostic" | "guided_practice" | "transfer" | "recap";
  message: string;
  question: string;
  encouragement: string;
  answerPolicy: "coach_not_complete";
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

const preferenceLabels: Record<SupportPreference, { title: string; detail: string }> = {
  example_first: { title: "Example first", detail: "Show one, then let me try." },
  questions_first: { title: "Questions first", detail: "Help me find my starting point." },
  mix_it_up: { title: "Mix it up", detail: "Alternate examples and questions." }
};

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object" || !("error" in value)) return fallback;
  const error = value.error;
  if (!error || typeof error !== "object" || !("message" in error)) return fallback;
  return typeof error.message === "string" ? error.message : fallback;
}

function displayTimer(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function LearningWorkspace({
  courses,
  csrfToken
}: {
  courses: readonly Course[];
  csrfToken: string;
}) {
  const [selectedCourseId, setSelectedCourseId] = useState<CourseId | null>(null);
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
  const [error, setError] = useState("");

  const selectedTrack = useMemo(
    () => selectedCourseId ? getLearningTrack(selectedCourseId) : null,
    [selectedCourseId]
  );
  const sessionInProgress = Boolean(
    active && (status === "active" || status === "sending" || status === "completing")
  );

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
    if (sessionInProgress) return;
    setSelectedCourseId(courseId);
    setStatus("idle");
    setActive(null);
    setDialogue([]);
    setCompletion(null);
    setError("");
    void loadContext(courseId);
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
          <p className="eyebrow">LEARN · SEVEN INDEPENDENT TRACKS</p>
          <h2 id="learning-title">Choose where to get ready</h2>
          <p>Every class opens a focused AI-led session. School plans and Family actions stay separate.</p>
        </div>
        <span className="learning-trust">Private by default · no grades</span>
      </header>

      <div className="learning-track-grid">
        {courses.map((course) => {
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
              <strong>{track.mission.title}</strong>
              <small>{track.mission.suggestedMinutes} min readiness</small>
            </button>
          );
        })}
      </div>

      {selectedTrack && (
        <section className="learning-stage" aria-live="polite">
          <div className="learning-stage-heading">
            <div>
              <span className="source-chip">{selectedTrack.mission.source.label}</span>
              <h3>{selectedTrack.trackTitle}</h3>
              <p><strong>{selectedTrack.mission.title}:</strong> {selectedTrack.mission.objective}</p>
            </div>
            {(status === "active" || status === "sending" || status === "completing") && (
              <div className="learning-clock" aria-label={`${displayTimer(remainingSeconds)} remaining`}>
                <span>{displayTimer(remainingSeconds)}</span>
                <small>focused time left</small>
              </div>
            )}
          </div>

          {(status === "idle" || status === "error" || status === "starting") && !completion && (
            <div className="learning-setup">
              <fieldset>
                <legend>Choose a timebox</legend>
                <div className="learning-choice-row">
                  {([10, 15, 20] as const).map((duration) => (
                    <button
                      key={duration}
                      type="button"
                      aria-pressed={durationMinutes === duration}
                      onClick={() => setDurationMinutes(duration)}
                    >{duration} min</button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>How should Homeroom begin?</legend>
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
                      <span><strong>{preferenceLabels[preference].title}</strong><small>{preferenceLabels[preference].detail}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                className="learning-start-button"
                disabled={status === "starting"}
                onClick={startLearning}
              >
                {status === "starting" ? "Opening live coach…" : `Start ${durationMinutes}-minute session`}
              </button>
            </div>
          )}

          {(status === "active" || status === "sending" || status === "completing") && active && (
            <div className="learning-live">
              <div className="learning-live-proof">
                <span><i /> Live GPT-5.6 Sol coach</span>
                <small>App-owned context · OpenAI store: false</small>
              </div>
              <div className="learning-dialogue">
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
                <label htmlFor="learning-response">Your response to Homeroom</label>
                <div>
                  <textarea
                    id="learning-response"
                    aria-label="Your response to Homeroom"
                    maxLength={500}
                    value={responseText}
                    disabled={status !== "active"}
                    onChange={(event) => setResponseText(event.target.value)}
                    placeholder="Share your thinking—not just an answer."
                  />
                  <button disabled={!responseText.trim() || status !== "active"} type="submit">
                    {status === "sending" ? "Coach is thinking…" : "Send to coach"}
                  </button>
                </div>
              </form>
              <div className="learning-session-actions">
                <span>The clock guides the pace. Emily can end anytime.</span>
                <button disabled={status === "completing" || status === "sending"} onClick={completeSession}>
                  {status === "completing" ? "Saving recap…" : "End and save session"}
                </button>
              </div>
            </div>
          )}

          {completion && status === "completed" && (
            <div className="learning-complete">
              <span className="learning-complete-mark">✓</span>
              <div>
                <p className="eyebrow">SESSION SAVED · {completion.summary.objectiveStatus}</p>
                <h4>{completion.summary.missionTitle}</h4>
                <p>{completion.summary.objective}</p>
                <small>{completion.summary.completedTurns} student turn{completion.summary.completedTurns === 1 ? "" : "s"} · Golden state unchanged</small>
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
        </section>
      )}
    </section>
  );
}
