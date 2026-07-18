"use client";

import { useState, useSyncExternalStore, type CSSProperties } from "react";

interface Student {
  name: string;
  grade: number;
}

interface Course {
  id: string;
  name: string;
}

interface BandCamp {
  date: string;
  start: string;
  checkIn: string;
  end: string;
  departure: string;
  wake: string;
}

interface DemoResponse {
  sessionId: string;
  csrfToken: string;
  profile: Student;
}

interface MorningPlan {
  title: string;
  intro: string;
  steps: Array<{ time: string; title: string; detail: string; sourceLabel: string }>;
  guardianNote: string;
  encouragement: string;
  approvalPrompt: string;
}

interface MorningPlanResponse {
  plan: MorningPlan;
  approval: {
    actionId: string;
    receipt: string;
    expiresAt: string;
    planVersion: 1;
    stateVersion: number;
  };
  proof: {
    model: string;
    responseIds: string[];
    tools: string[];
    sourceVersion: number;
  };
}

interface SavedPlanResponse {
  saved: true;
  planVersion: 1;
  phase: "PLAN_V1_SAVED";
  savedAt: string;
  proof: {
    approvalId: string;
    argsHash: string;
    sourceVersion: 1;
    stateVersion: number;
  };
}

interface PlanRevisionResponse {
  revision: {
    change: {
      title: string;
      summary: string;
      changedField: "checkIn";
      before: "07:30";
      after: "07:15";
      minutesEarlier: 15;
      sourceLabel: string;
    };
    plan: MorningPlan;
  };
  approval: {
    actionId: string;
    receipt: string;
    expiresAt: string;
    planVersion: 2;
    stateVersion: number;
  };
  proof: {
    model: string;
    responseIds: string[];
    tools: string[];
    sourceVersion: 2;
    previousPlanVersion: 1;
  };
}

interface SavedPlanV2Response {
  saved: true;
  planVersion: 2;
  phase: "PLAN_V2_SAVED";
  savedAt: string;
  proof: {
    approvalId: string;
    argsHash: string;
    sourceVersion: 2;
    stateVersion: number;
  };
}

interface PracticeStartResponse {
  exercise: { id: string; course: "Algebra I"; prompt: string };
  hint: {
    title: string;
    encouragement: string;
    question: string;
    concept: "inverse operations";
    answerPolicy: "hidden";
  };
  progress: { hintsUsed: 1; attempts: 0; stateVersion: number };
  proof: {
    model: string;
    responseIds: string[];
    tools: string[];
    exerciseId: string;
  };
}

interface PracticeStepResponse {
  correct: boolean;
  completed: false;
  equation?: string;
  feedback: string;
  next?: { kind: "final_answer"; prompt: string };
  proof: { grader: "homeroom-deterministic-v1"; attempts: number; stateVersion: number };
}

interface PracticeCompleteResponse {
  correct: true;
  completed: true;
  answer: "x = 4";
  celebration: string;
  proof: {
    grader: "homeroom-deterministic-v1";
    exerciseId: string;
    hintsUsed: number;
    attempts: number;
    stateVersion: number;
    completedAt: string;
  };
}

interface GuardianProjection {
  projectionVersion: 1;
  recipient: { id: string; name: "Matt"; relationship: "Parent" };
  student: { id: string; name: "Emily"; grade: 9 };
  headline: string;
  shared: {
    bandCamp: { date: string; checkIn: string; start: string };
    morningPlan: { planVersion: 2; wake: string; leave: string; status: "saved" };
    practice: { course: "Algebra I"; status: "completed"; summary: string };
    guardianTask: { label: string; dueAt: string; status: "needs_guardian" };
  };
  privacy: { excluded: [string, string, string, string, string] };
  generatedAt: string;
}

interface GuardianPreviewResponse {
  preview: GuardianProjection;
  approval: {
    actionId: string;
    receipt: string;
    expiresAt: string;
    projectionVersion: 1;
    stateVersion: number;
  };
  proof: {
    projectionHash: string;
    sourceVersion: 2;
    activePlanVersion: 2;
    privateFieldCount: number;
  };
}

interface GuardianPublishedResponse {
  published: true;
  projectionVersion: 1;
  phase: "GUARDIAN_PUBLISHED";
  publishedAt: string;
  recipient: "Matt";
  view: GuardianProjection;
  proof: {
    approvalId: string;
    argsHash: string;
    projectionHash: string;
    stateVersion: number;
  };
}

function displayClock(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = (hours ?? 0) >= 12 ? "PM" : "AM";
  const displayHours = (hours ?? 0) % 12 || 12;
  return `${displayHours}:${String(minutes ?? 0).padStart(2, "0")} ${suffix}`;
}

const Icon = ({ name }: { name: "spark" | "calendar" | "book" | "shield" | "arrow" | "clock" }) => {
  const paths = {
    spark: <path d="M12 2.8c.45 4.25 2.95 6.75 7.2 7.2-4.25.45-6.75 2.95-7.2 7.2-.45-4.25-2.95-6.75-7.2-7.2 4.25-.45 6.75-2.95 7.2-7.2Z" />,
    calendar: <path d="M6.5 3v2m11-2v2M4 8.5h16M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5Z" />,
    book: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Zm16 0A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />,
    shield: <path d="M12 2.8 19 5.5v5.8c0 4.4-2.65 8.2-7 9.9-4.35-1.7-7-5.5-7-9.9V5.5l7-2.7Zm-3.2 9.1 2.1 2.1 4.5-4.5" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 1.8" />
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">{paths[name]}</svg>;
};

const subscribeToHydration = () => () => {};
const clientHydrationSnapshot = () => true;
const serverHydrationSnapshot = () => false;

export function HomeroomDemo({ student, courses, bandCamp }: { student: Student; courses: readonly Course[]; bandCamp: BandCamp }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrationSnapshot, serverHydrationSnapshot);
  const [status, setStatus] = useState<"ready" | "starting" | "active" | "error">("ready");
  const [error, setError] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [planStatus, setPlanStatus] = useState<"idle" | "building" | "ready" | "error">("idle");
  const [planError, setPlanError] = useState("");
  const [morningPlan, setMorningPlan] = useState<MorningPlanResponse | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [approvalError, setApprovalError] = useState("");
  const [savedPlan, setSavedPlan] = useState<SavedPlanResponse | null>(null);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [updateError, setUpdateError] = useState("");
  const [planRevision, setPlanRevision] = useState<PlanRevisionResponse | null>(null);
  const [v2ApprovalStatus, setV2ApprovalStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [v2ApprovalError, setV2ApprovalError] = useState("");
  const [savedPlanV2, setSavedPlanV2] = useState<SavedPlanV2Response | null>(null);
  const [practiceStatus, setPracticeStatus] = useState<"idle" | "starting" | "active" | "complete" | "error">("idle");
  const [practiceError, setPracticeError] = useState("");
  const [practiceLesson, setPracticeLesson] = useState<PracticeStartResponse | null>(null);
  const [practiceStep, setPracticeStep] = useState<PracticeStepResponse | null>(null);
  const [practiceFeedback, setPracticeFeedback] = useState("");
  const [practiceAttemptStatus, setPracticeAttemptStatus] = useState<"idle" | "checking">("idle");
  const [finalAnswer, setFinalAnswer] = useState("");
  const [practiceComplete, setPracticeComplete] = useState<PracticeCompleteResponse | null>(null);
  const [guardianStatus, setGuardianStatus] = useState<"idle" | "preparing" | "ready" | "error">("idle");
  const [guardianError, setGuardianError] = useState("");
  const [guardianPreview, setGuardianPreview] = useState<GuardianPreviewResponse | null>(null);
  const [guardianPublishStatus, setGuardianPublishStatus] = useState<"idle" | "publishing" | "published" | "error">("idle");
  const [guardianPublishError, setGuardianPublishError] = useState("");
  const [guardianPublished, setGuardianPublished] = useState<GuardianPublishedResponse | null>(null);
  const displayedBandCamp = planRevision
    ? {
        wake: planRevision.revision.plan.steps[0]!.time,
        departure: planRevision.revision.plan.steps[2]!.time,
        checkIn: planRevision.revision.plan.steps[3]!.time,
        start: bandCamp.start
      }
    : bandCamp;
  const guardianView = guardianPublished?.view ?? guardianPreview?.preview;

  async function startDemo() {
    setStatus("starting");
    setError("");
    try {
      const response = await fetch("/api/demo-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureKey: "emily_band_camp_v1", role: "student" })
      });
      const data = (await response.json()) as DemoResponse | { error?: { message?: string } };
      if (!response.ok) throw new Error("error" in data ? data.error?.message : "Unable to start the demo.");
      setCsrfToken((data as DemoResponse).csrfToken);
      setStatus("active");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start the demo.");
      setStatus("error");
    }
  }

  async function buildMorningPlan() {
    if (!csrfToken) {
      setPlanError("Start a new Homeroom session before building your plan.");
      setPlanStatus("error");
      return;
    }
    setPlanStatus("building");
    setPlanError("");
    setApprovalStatus("idle");
    setApprovalError("");
    setSavedPlan(null);
    try {
      const response = await fetch("/api/morning-plan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-homeroom-csrf": csrfToken
        },
        body: "{}"
      });
      const data = (await response.json()) as MorningPlanResponse | { error?: { message?: string } };
      if (!response.ok || !("plan" in data)) {
        throw new Error("error" in data ? data.error?.message : "Unable to build your morning plan.");
      }
      setMorningPlan(data);
      setPlanStatus("ready");
    } catch (caught) {
      setPlanError(caught instanceof Error ? caught.message : "Unable to build your morning plan.");
      setPlanStatus("error");
    }
  }

  async function approveMorningPlan() {
    if (!csrfToken || !morningPlan) return;
    setApprovalStatus("saving");
    setApprovalError("");
    try {
      const response = await fetch("/api/morning-plan/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-homeroom-csrf": csrfToken
        },
        body: JSON.stringify({
          actionId: morningPlan.approval.actionId,
          receipt: morningPlan.approval.receipt
        })
      });
      const data = (await response.json()) as SavedPlanResponse | { error?: { message?: string } };
      if (!response.ok || !("saved" in data)) {
        throw new Error("error" in data ? data.error?.message : "Unable to save your plan.");
      }
      setSavedPlan(data);
      setApprovalStatus("saved");
    } catch (caught) {
      setApprovalError(caught instanceof Error ? caught.message : "Unable to save your plan.");
      setApprovalStatus("error");
    }
  }

  async function checkBandUpdates() {
    if (!csrfToken || approvalStatus !== "saved") return;
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const response = await fetch("/api/plan-update", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-homeroom-csrf": csrfToken
        },
        body: "{}"
      });
      const data = (await response.json()) as PlanRevisionResponse | { error?: { message?: string } };
      if (!response.ok || !("revision" in data)) {
        throw new Error("error" in data ? data.error?.message : "Unable to check BAND updates.");
      }
      setPlanRevision(data);
      setUpdateStatus("ready");
    } catch (caught) {
      setUpdateError(caught instanceof Error ? caught.message : "Unable to check BAND updates.");
      setUpdateStatus("error");
    }
  }

  async function approvePlanV2() {
    if (!csrfToken || !planRevision) return;
    setV2ApprovalStatus("saving");
    setV2ApprovalError("");
    try {
      const response = await fetch("/api/plan-update/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-homeroom-csrf": csrfToken
        },
        body: JSON.stringify({
          actionId: planRevision.approval.actionId,
          receipt: planRevision.approval.receipt
        })
      });
      const data = (await response.json()) as SavedPlanV2Response | { error?: { message?: string } };
      if (!response.ok || !("saved" in data)) {
        throw new Error("error" in data ? data.error?.message : "Unable to save Plan V2.");
      }
      setSavedPlanV2(data);
      setV2ApprovalStatus("saved");
    } catch (caught) {
      setV2ApprovalError(caught instanceof Error ? caught.message : "Unable to save Plan V2.");
      setV2ApprovalStatus("error");
    }
  }

  async function startAlgebraPractice() {
    if (!csrfToken || !savedPlanV2) return;
    setPracticeStatus("starting");
    setPracticeError("");
    try {
      const response = await fetch("/api/practice/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-homeroom-csrf": csrfToken
        },
        body: "{}"
      });
      const data = (await response.json()) as PracticeStartResponse | { error?: { message?: string } };
      if (!response.ok || !("hint" in data)) {
        throw new Error("error" in data ? data.error?.message : "Unable to start the Algebra refresher.");
      }
      setPracticeLesson(data);
      setPracticeStatus("active");
    } catch (caught) {
      setPracticeError(caught instanceof Error ? caught.message : "Unable to start the Algebra refresher.");
      setPracticeStatus("error");
    }
  }

  async function submitFirstPracticeStep(answer: "divide_both_sides_by_3" | "subtract_3" | "multiply_both_sides_by_3") {
    if (!csrfToken || !practiceLesson) return;
    setPracticeAttemptStatus("checking");
    setPracticeError("");
    try {
      const response = await fetch("/api/practice/attempt", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-homeroom-csrf": csrfToken
        },
        body: JSON.stringify({ kind: "first_step", answer })
      });
      const data = (await response.json()) as PracticeStepResponse | { error?: { message?: string } };
      if (!response.ok || !("correct" in data)) {
        throw new Error("error" in data ? data.error?.message : "Unable to check that step.");
      }
      setPracticeFeedback(data.feedback);
      if (data.correct) setPracticeStep(data);
    } catch (caught) {
      setPracticeError(caught instanceof Error ? caught.message : "Unable to check that step.");
    } finally {
      setPracticeAttemptStatus("idle");
    }
  }

  async function submitFinalPracticeAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken || !practiceStep || !finalAnswer.trim()) return;
    setPracticeAttemptStatus("checking");
    setPracticeError("");
    try {
      const response = await fetch("/api/practice/attempt", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-homeroom-csrf": csrfToken
        },
        body: JSON.stringify({ kind: "final_answer", answer: finalAnswer.trim() })
      });
      const data = (await response.json()) as PracticeStepResponse | PracticeCompleteResponse | { error?: { message?: string } };
      if (!response.ok || !("correct" in data)) {
        throw new Error("error" in data ? data.error?.message : "Unable to check your answer.");
      }
      if (data.completed) {
        setPracticeComplete(data);
        setPracticeStatus("complete");
        setPracticeFeedback("");
      } else {
        setPracticeFeedback(data.feedback);
      }
    } catch (caught) {
      setPracticeError(caught instanceof Error ? caught.message : "Unable to check your answer.");
    } finally {
      setPracticeAttemptStatus("idle");
    }
  }

  async function previewForMatt() {
    if (!csrfToken || !practiceComplete) return;
    setGuardianStatus("preparing");
    setGuardianError("");
    setGuardianPublishStatus("idle");
    setGuardianPublishError("");
    setGuardianPublished(null);
    try {
      const response = await fetch("/api/guardian/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-homeroom-csrf": csrfToken
        },
        body: "{}"
      });
      const data = (await response.json()) as GuardianPreviewResponse | { error?: { message?: string } };
      if (!response.ok || !("preview" in data)) {
        throw new Error("error" in data ? data.error?.message : "Unable to prepare Matt's preview.");
      }
      setGuardianPreview(data);
      setGuardianStatus("ready");
    } catch (caught) {
      setGuardianError(caught instanceof Error ? caught.message : "Unable to prepare Matt's preview.");
      setGuardianStatus("error");
    }
  }

  async function publishForMatt() {
    if (!csrfToken || !guardianPreview) return;
    setGuardianPublishStatus("publishing");
    setGuardianPublishError("");
    try {
      const response = await fetch("/api/guardian/publish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-homeroom-csrf": csrfToken
        },
        body: JSON.stringify({
          actionId: guardianPreview.approval.actionId,
          receipt: guardianPreview.approval.receipt
        })
      });
      const data = (await response.json()) as GuardianPublishedResponse | { error?: { message?: string } };
      if (!response.ok || !("published" in data)) {
        throw new Error("error" in data ? data.error?.message : "Unable to share the approved view with Matt.");
      }
      setGuardianPublished(data);
      setGuardianPublishStatus("published");
    } catch (caught) {
      setGuardianPublishError(caught instanceof Error ? caught.message : "Unable to share the approved view with Matt.");
      setGuardianPublishStatus("error");
    }
  }

  return (
    <main className="app-shell">
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Homeroom home">
          <span className="brand-mark"><Icon name="spark" /></span>
          <span>homeroom</span>
        </a>
        <div className="topbar-center">
          <span className="nav-pill active"><Icon name="spark" /> Today</span>
          <span className="nav-pill"><Icon name="calendar" /> My week</span>
          <span className="nav-pill"><Icon name="book" /> Learn</span>
        </div>
        <div className="student-chip">
          <span className="student-avatar">E</span>
          <span><strong>{student.name}</strong><small>Grade {student.grade}</small></span>
        </div>
      </nav>

      <div className="workspace" id="top">
        <aside className="rail">
          <div className="date-tile"><strong>18</strong><span>JUL</span></div>
          <div className="rail-line" />
          <div className="rail-event current"><span className="rail-dot" /><strong>Today</strong><small>Summer prep</small></div>
          <div className="rail-event"><span className="rail-dot" /><strong>Jul 24</strong><small>Physical due</small></div>
          <div className="rail-event"><span className="rail-dot" /><strong>Aug 3</strong><small>Band camp</small></div>
          <div className="rail-trust"><Icon name="shield" /><span><strong>Student-safe</strong><small>Guardian connected</small></span></div>
        </aside>

        <section className="content">
          <header className="welcome-row">
            <div>
              <p className="eyebrow">SATURDAY, JULY 18</p>
              <h1>Hi {student.name}. <span>Ready for what&apos;s next?</span></h1>
              <p className="welcome-copy">I pulled together the few things worth your attention today.</p>
            </div>
            <div className="day-score" aria-label="Fourteen day preparation streak">
              <span className="score-ring">14</span>
              <span><strong>day streak</strong><small>You&apos;re building momentum</small></span>
            </div>
          </header>

          {status !== "active" ? (
            <section className="start-card" aria-live="polite">
              <div className="start-glow" />
              <div className="start-icon"><Icon name="spark" /></div>
              <p className="eyebrow">YOUR DAY, ORGANIZED</p>
              <h2>Let&apos;s get you ready for band camp.</h2>
              <p>Homeroom found one upcoming event, one guardian task, and a simple way to keep your classes fresh.</p>
              <button className="primary-button" disabled={!hydrated || status === "starting"} onClick={startDemo}>
                {!hydrated ? "Loading Homeroom…" : status === "starting" ? "Getting your day ready…" : "Start my day"}
                {status !== "starting" && <Icon name="arrow" />}
              </button>
              {status === "error" && <p className="error-message">{error}</p>}
              <div className="consent-note"><Icon name="shield" /> Fictional demo data · Emily controls what is shared</div>
            </section>
          ) : (
            <div className="dashboard-grid">
              <section className="band-card card">
                <div className="card-label">
                  <span className="source-dot" /> FROM BAND CALENDAR · SOURCE V{planRevision ? 2 : 1}
                </div>
                <div className="band-heading">
                  <div><p>COMING UP IN 16 DAYS</p><h2>First day of band camp</h2></div>
                  <div className="countdown"><strong>16</strong><span>DAYS</span></div>
                </div>
                <div className="time-track">
                  <div><span className="time-dot wake" /><small>WAKE UP</small><strong>{displayClock(displayedBandCamp.wake)}</strong></div>
                  <div><span className="time-dot leave" /><small>LEAVE HOME</small><strong>{displayClock(displayedBandCamp.departure)}</strong></div>
                  <div><span className="time-dot arrive" /><small>CHECK IN</small><strong>{displayClock(displayedBandCamp.checkIn)}</strong></div>
                  <div><span className="time-dot start" /><small>CAMP STARTS</small><strong>{displayClock(displayedBandCamp.start)}</strong></div>
                </div>
                <button
                  aria-controls="morning-plan-proposal"
                  className="text-button plan-trigger"
                  disabled={planStatus === "building" || morningPlan !== null}
                  onClick={buildMorningPlan}
                >
                  {planStatus === "building"
                    ? "Building from your approved sources…"
                    : morningPlan
                      ? "Proposal ready for review"
                      : "Build my morning plan"}
                  {planStatus !== "building" && !morningPlan && <Icon name="arrow" />}
                </button>
                {planStatus === "error" && <p className="plan-error" role="alert">{planError}</p>}
                {morningPlan && (
                  <section className="morning-plan" id="morning-plan-proposal" aria-live="polite">
                    <div className="plan-proof-row">
                      <span className="live-model"><span className="live-dot" /> Live GPT-5.6 Sol</span>
                      <span>Source version {morningPlan.proof.sourceVersion}</span>
                      <span>{morningPlan.proof.tools.length} approved tool</span>
                    </div>
                    <div className="plan-copy">
                      <p className="eyebrow">PROPOSED FOR EMILY</p>
                      <h3>{morningPlan.plan.title}</h3>
                      <p>{morningPlan.plan.intro}</p>
                    </div>
                    <ol className="plan-steps">
                      {morningPlan.plan.steps.map((step) => (
                        <li key={`${step.time}-${step.title}`}>
                          <time>{step.time}</time>
                          <span className="plan-step-marker" />
                          <div>
                            <strong>{step.title}</strong>
                            <p>{step.detail}</p>
                            <small>{step.sourceLabel}</small>
                          </div>
                        </li>
                      ))}
                    </ol>
                    <div className="plan-guardian-note"><Icon name="shield" /><span>{morningPlan.plan.guardianNote}</span></div>
                    <blockquote>{morningPlan.plan.encouragement}</blockquote>
                    <div className="plan-review">
                      {approvalStatus === "saved" && savedPlan ? (
                        <div className="plan-saved" role="status">
                          <span className="saved-check" aria-hidden="true">✓</span>
                          <span>
                            <strong>Plan V1 saved</strong>
                            <small>Saved by Emily · Source version {savedPlan.proof.sourceVersion}</small>
                          </span>
                          <span className="saved-version">STATE {savedPlan.proof.stateVersion}</span>
                        </div>
                      ) : (
                        <>
                          <div className="approval-copy">
                            <strong>{morningPlan.plan.approvalPrompt}</strong>
                            <small>Nothing has been saved yet</small>
                          </div>
                          <button
                            className="approve-button"
                            disabled={approvalStatus === "saving"}
                            onClick={approveMorningPlan}
                          >
                            {approvalStatus === "saving" ? "Saving the exact plan…" : "Approve and save Plan V1"}
                            {approvalStatus !== "saving" && <Icon name="arrow" />}
                          </button>
                        </>
                      )}
                    </div>
                    {approvalStatus === "error" && <p className="approval-error" role="alert">{approvalError}</p>}
                    <div className="approval-proof">
                      <span>
                        {approvalStatus === "saved"
                          ? "Approval consumed · exact approved content recorded"
                          : `Approval is bound to this exact plan · expires ${new Date(morningPlan.approval.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                      </span>
                      <div className="proof-token" title={morningPlan.proof.model}>
                        <span>MODEL TRACE</span>
                        <strong>{morningPlan.proof.responseIds.length} responses verified</strong>
                      </div>
                    </div>
                  </section>
                )}
                {approvalStatus === "saved" && (
                  <section className="source-update" id="source-update" aria-live="polite">
                    {!planRevision ? (
                      <div className="update-check-row">
                        <div>
                          <p className="eyebrow">NEXT GOLDEN MOMENT</p>
                          <strong>Plans should keep up when a school source changes.</strong>
                          <small>We&apos;ll check the controlled BAND fixture for one new calendar version.</small>
                        </div>
                        <button
                          className="source-check-button"
                          disabled={updateStatus === "checking"}
                          onClick={checkBandUpdates}
                        >
                          {updateStatus === "checking" ? "Checking the BAND calendar…" : "Check BAND for updates"}
                          {updateStatus !== "checking" && <Icon name="arrow" />}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="source-version-row">
                          <span><span className="live-dot" /> BAND calendar update</span>
                          <span>SOURCE V1 → V2</span>
                        </div>
                        <div className="change-heading">
                          <div>
                            <p className="eyebrow">ONE SOURCE FACT CHANGED</p>
                            <h3>{planRevision.revision.change.title}</h3>
                            <p>{planRevision.revision.change.summary}</p>
                          </div>
                          <div className="time-diff" aria-label="Check-in changed from 7:30 AM to 7:15 AM">
                            <span><small>BEFORE</small><strong>{displayClock(planRevision.revision.change.before)}</strong></span>
                            <Icon name="arrow" />
                            <span className="new-time"><small>NOW</small><strong>{displayClock(planRevision.revision.change.after)}</strong></span>
                          </div>
                        </div>
                        <div className="change-evidence">
                          <Icon name="calendar" />
                          <span>{planRevision.revision.change.sourceLabel}</span>
                          <strong>{planRevision.revision.change.minutesEarlier} minutes earlier</strong>
                        </div>

                        <div className="revision-boundary">
                          <span>Plan V1 is still active</span>
                          <span>Nothing changes until Emily approves Plan V2</span>
                        </div>
                        <div className="plan-copy revision-copy">
                          <p className="eyebrow">PROPOSED PLAN V2</p>
                          <h3>{planRevision.revision.plan.title}</h3>
                          <p>{planRevision.revision.plan.intro}</p>
                        </div>
                        <ol className="plan-steps revision-steps">
                          {planRevision.revision.plan.steps.map((step) => (
                            <li key={`v2-${step.time}-${step.title}`}>
                              <time>{step.time}</time>
                              <span className="plan-step-marker" />
                              <div>
                                <strong>{step.title}</strong>
                                <p>{step.detail}</p>
                                <small>{step.sourceLabel}</small>
                              </div>
                            </li>
                          ))}
                        </ol>
                        <div className="plan-guardian-note"><Icon name="shield" /><span>{planRevision.revision.plan.guardianNote}</span></div>
                        <blockquote>{planRevision.revision.plan.encouragement}</blockquote>

                        <div className="v2-review">
                          {v2ApprovalStatus === "saved" && savedPlanV2 ? (
                            <div className="plan-saved" role="status">
                              <span className="saved-check" aria-hidden="true">✓</span>
                              <span>
                                <strong>Plan V2 saved</strong>
                                <small>Saved by Emily · Source version {savedPlanV2.proof.sourceVersion}</small>
                              </span>
                              <span className="saved-version">STATE {savedPlanV2.proof.stateVersion}</span>
                            </div>
                          ) : (
                            <>
                              <div className="approval-copy">
                                <strong>{planRevision.revision.plan.approvalPrompt}</strong>
                                <small>Plan V1 remains active</small>
                              </div>
                              <button
                                className="approve-button"
                                disabled={v2ApprovalStatus === "saving"}
                                onClick={approvePlanV2}
                              >
                                {v2ApprovalStatus === "saving" ? "Saving the exact revision…" : "Approve and save Plan V2"}
                                {v2ApprovalStatus !== "saving" && <Icon name="arrow" />}
                              </button>
                            </>
                          )}
                        </div>
                        {v2ApprovalStatus === "error" && <p className="approval-error" role="alert">{v2ApprovalError}</p>}
                        <div className="approval-proof">
                          <span>
                            {v2ApprovalStatus === "saved"
                              ? "Approval consumed · Plan V1 retained as immutable history"
                              : `Exact Plan V2 approval expires ${new Date(planRevision.approval.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                          </span>
                          <div className="proof-token" title={planRevision.proof.model}>
                            <span>MODEL TRACE</span>
                            <strong>{planRevision.proof.responseIds.length} responses verified</strong>
                          </div>
                        </div>
                      </>
                    )}
                    {updateStatus === "error" && <p className="approval-error" role="alert">{updateError}</p>}
                  </section>
                )}
              </section>

              <section className="prep-card card">
                <div className="section-heading"><div><p className="eyebrow">TODAY&apos;S QUICK WIN</p><h2>10-minute tune-up</h2></div><span className="duration"><Icon name="clock" /> 10 min</span></div>
                <div className="prep-list">
                  <label><input type="checkbox" defaultChecked /><span><strong>Warm up your instrument</strong><small>Long tones · 4 minutes</small></span></label>
                  <div className={`prep-practice-row ${practiceStatus === "complete" ? "complete" : ""}`}>
                    <span className="practice-check" aria-hidden="true">{practiceStatus === "complete" ? "✓" : ""}</span>
                    <span><strong>One Algebra refresher</strong><small>Solve 3(x + 2) = 18 · hints, not answers</small></span>
                    {practiceLesson ? (
                      <span className="practice-row-status">{practiceStatus === "complete" ? "Done" : "In progress"}</span>
                    ) : (
                      <button
                        className="practice-start-button"
                        disabled={!savedPlanV2 || practiceStatus === "starting"}
                        onClick={startAlgebraPractice}
                      >
                        {!savedPlanV2
                          ? "Save Plan V2 first"
                          : practiceStatus === "starting"
                            ? "Preparing your hint…"
                            : "Start Algebra refresher"}
                      </button>
                    )}
                  </div>
                  <label><input type="checkbox" /><span><strong>Check the packing list</strong><small>Six essentials from your band director</small></span></label>
                </div>
                {practiceLesson && (
                  <section className="practice-workspace" aria-live="polite">
                    <div className="practice-proof-row">
                      <span className="live-model"><span className="live-dot" /> Live GPT-5.6 Sol hint</span>
                      <span>Hint {practiceLesson.progress.hintsUsed} of 1</span>
                      <span className="answer-hidden"><Icon name="shield" /> Answer hidden until you solve it</span>
                    </div>
                    {practiceComplete ? (
                      <div className="practice-celebration" role="status">
                        <span className="celebration-mark" aria-hidden="true">✓</span>
                        <p className="eyebrow">PRACTICE COMPLETE</p>
                        <h3>Practice complete</h3>
                        <div className="completed-equation">{practiceComplete.answer}</div>
                        <p>{practiceComplete.celebration}</p>
                        <small>
                          Deterministically graded · {practiceComplete.proof.attempts} attempts · {practiceComplete.proof.hintsUsed} hint
                        </small>
                        <span className="practice-state">STATE {practiceComplete.proof.stateVersion}</span>
                      </div>
                    ) : (
                      <>
                        <div className="practice-heading">
                          <div>
                            <p className="eyebrow">ALGEBRA I · INVERSE OPERATIONS</p>
                            <h3>{practiceLesson.hint.title}</h3>
                            <p>{practiceLesson.hint.encouragement}</p>
                          </div>
                          <div className="practice-equation" aria-label={`Solve ${practiceLesson.exercise.prompt}`}>
                            {practiceLesson.exercise.prompt}
                          </div>
                        </div>
                        {!practiceStep ? (
                          <div className="practice-question">
                            <strong>{practiceLesson.hint.question}</strong>
                            <div className="practice-choices">
                              <button disabled={practiceAttemptStatus === "checking"} onClick={() => submitFirstPracticeStep("divide_both_sides_by_3")}>Divide both sides by 3</button>
                              <button disabled={practiceAttemptStatus === "checking"} onClick={() => submitFirstPracticeStep("subtract_3")}>Subtract 3 from both sides</button>
                              <button disabled={practiceAttemptStatus === "checking"} onClick={() => submitFirstPracticeStep("multiply_both_sides_by_3")}>Multiply both sides by 3</button>
                            </div>
                          </div>
                        ) : (
                          <div className="practice-final-step">
                            <div className="validated-step">
                              <span>✓</span>
                              <div><small>STEP VERIFIED BY HOMEROOM</small><strong>{practiceStep.equation}</strong></div>
                            </div>
                            <form onSubmit={submitFinalPracticeAnswer}>
                              <label htmlFor="final-algebra-answer">{practiceStep.next?.prompt}</label>
                              <div className="answer-entry">
                                <span>x =</span>
                                <input
                                  id="final-algebra-answer"
                                  aria-label="What is x?"
                                  autoComplete="off"
                                  inputMode="decimal"
                                  maxLength={16}
                                  value={finalAnswer}
                                  onChange={(event) => setFinalAnswer(event.target.value)}
                                />
                                <button disabled={practiceAttemptStatus === "checking" || !finalAnswer.trim()} type="submit">
                                  {practiceAttemptStatus === "checking" ? "Checking…" : "Check my answer"}
                                </button>
                              </div>
                            </form>
                          </div>
                        )}
                        {practiceFeedback && <p className={`practice-feedback ${practiceStep ? "correct" : ""}`}>{practiceFeedback}</p>}
                        {practiceError && <p className="approval-error" role="alert">{practiceError}</p>}
                        <div className="practice-boundary">
                          <span>GPT coaches the next move</span>
                          <span>Homeroom code grades every step</span>
                        </div>
                      </>
                    )}
                  </section>
                )}
                {practiceStatus === "error" && <p className="approval-error" role="alert">{practiceError}</p>}
                <div className={`progress-line ${practiceStatus === "complete" ? "practice-done" : ""}`}><span /></div>
                <small className="progress-copy">{practiceStatus === "complete" ? "2 of 3 ready" : "1 of 3 ready"}</small>
              </section>

              <section className="classes-card card">
                <div className="section-heading"><div><p className="eyebrow">LOOKING AHEAD</p><h2>Your {courses.length} ninth-grade classes</h2></div><button className="icon-button" aria-label="Open classes"><Icon name="arrow" /></button></div>
                <div className="course-cloud">
                  {courses.map((course, index) => <span key={course.id} style={{ "--course-index": index } as CSSProperties}>{course.name}</span>)}
                </div>
                <p className="card-footnote">A little practice now makes August feel lighter.</p>
              </section>

              <section className="guardian-card card">
                <div className="guardian-icon"><Icon name="shield" /></div>
                <div className="guardian-card-copy">
                  <p className="eyebrow">NEEDS A GUARDIAN</p>
                  <h2>Band physical form</h2>
                  <p>Matt can complete this by Friday, July 24.</p>
                </div>
                <button
                  className="secondary-button"
                  disabled={!practiceComplete || guardianStatus === "preparing" || guardianStatus === "ready"}
                  onClick={previewForMatt}
                >
                  {!practiceComplete
                    ? "Finish practice first"
                    : guardianStatus === "preparing"
                      ? "Preparing private preview…"
                      : guardianStatus === "ready"
                        ? "Preview ready"
                        : "Preview for Matt"}
                </button>
                {guardianError && <p className="guardian-error" role="alert">{guardianError}</p>}
                {guardianPreview && guardianView && (
                  <section className="guardian-preview" aria-live="polite">
                    <div className="guardian-preview-heading">
                      <div>
                        <p className="eyebrow">GUARDIAN SHARE PREVIEW</p>
                        <h3>Exactly what Matt will see</h3>
                        <p>{guardianView.headline}</p>
                      </div>
                      <span className="recipient-chip"><span>M</span> Matt · Parent</span>
                    </div>

                    <div className="guardian-safe-grid">
                      <article>
                        <small>BAND CAMP</small>
                        <strong>Monday, August 3</strong>
                        <span>{displayClock(guardianView.shared.bandCamp.checkIn)} check-in · {displayClock(guardianView.shared.bandCamp.start)} start</span>
                      </article>
                      <article>
                        <small>MORNING PLAN</small>
                        <strong>Plan V{guardianView.shared.morningPlan.planVersion} saved</strong>
                        <span>{displayClock(guardianView.shared.morningPlan.wake)} wake · {displayClock(guardianView.shared.morningPlan.leave)} leave</span>
                      </article>
                      <article>
                        <small>PRACTICE</small>
                        <strong>{guardianView.shared.practice.course} complete</strong>
                        <span>{guardianView.shared.practice.summary}</span>
                      </article>
                      <article>
                        <small>MATT&apos;S TASK</small>
                        <strong>Band physical form</strong>
                        <span>Due Friday, July 24</span>
                      </article>
                    </div>

                    <div className="guardian-privacy-boundary">
                      <div className="privacy-heading">
                        <span className="privacy-shield"><Icon name="shield" /></span>
                        <div><strong>Kept private in Emily&apos;s workspace</strong><small>These details are not in Matt&apos;s view.</small></div>
                      </div>
                      <ul>
                        {guardianView.privacy.excluded.map((field) => <li key={field}>{field}</li>)}
                      </ul>
                    </div>

                    <div className={`guardian-share-boundary ${guardianPublished ? "published" : ""}`}>
                      {guardianPublished ? (
                        <>
                          <span className="saved-check">✓</span>
                          <div><strong>Shared with Matt</strong><small>Only the exact preview above was published.</small></div>
                          <span className="guardian-state">STATE {guardianPublished.proof.stateVersion}</span>
                        </>
                      ) : (
                        <>
                          <div className="share-status">
                            <span className="not-shared-dot" />
                            <div><strong>Not shared yet</strong><small>Emily must approve this exact view.</small></div>
                          </div>
                          <button
                            className="approve-button"
                            disabled={guardianPublishStatus === "publishing"}
                            onClick={publishForMatt}
                          >
                            {guardianPublishStatus === "publishing" ? "Sharing approved view…" : "Approve and share with Matt"}
                            {guardianPublishStatus !== "publishing" && <Icon name="arrow" />}
                          </button>
                        </>
                      )}
                    </div>
                    {guardianPublishError && <p className="guardian-error" role="alert">{guardianPublishError}</p>}
                    <div className="guardian-proof-row">
                      <span>SERVER-BUILT ALLOWLIST · PROJECTION V1</span>
                      <span>HASH {guardianPreview.proof.projectionHash.slice(0, 10)}…</span>
                    </div>
                  </section>
                )}
              </section>
            </div>
          )}
        </section>
      </div>

      <footer className="demo-footer"><span><Icon name="shield" /> Private by design</span><span>Homeroom is a Build Week prototype using fictional student data.</span></footer>
    </main>
  );
}
