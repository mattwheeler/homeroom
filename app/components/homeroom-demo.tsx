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
                <div className="card-label"><span className="source-dot" /> FROM BAND CALENDAR</div>
                <div className="band-heading">
                  <div><p>COMING UP IN 16 DAYS</p><h2>First day of band camp</h2></div>
                  <div className="countdown"><strong>16</strong><span>DAYS</span></div>
                </div>
                <div className="time-track">
                  <div><span className="time-dot wake" /><small>WAKE UP</small><strong>{bandCamp.wake} AM</strong></div>
                  <div><span className="time-dot leave" /><small>LEAVE HOME</small><strong>{bandCamp.departure} AM</strong></div>
                  <div><span className="time-dot arrive" /><small>CHECK IN</small><strong>{bandCamp.checkIn} AM</strong></div>
                  <div><span className="time-dot start" /><small>CAMP STARTS</small><strong>{bandCamp.start} AM</strong></div>
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
              </section>

              <section className="prep-card card">
                <div className="section-heading"><div><p className="eyebrow">TODAY&apos;S QUICK WIN</p><h2>10-minute tune-up</h2></div><span className="duration"><Icon name="clock" /> 10 min</span></div>
                <div className="prep-list">
                  <label><input type="checkbox" defaultChecked /><span><strong>Warm up your instrument</strong><small>Long tones · 4 minutes</small></span></label>
                  <label><input type="checkbox" /><span><strong>One Algebra refresher</strong><small>Solve 3(x + 2) = 18</small></span></label>
                  <label><input type="checkbox" /><span><strong>Check the packing list</strong><small>Six essentials from your band director</small></span></label>
                </div>
                <div className="progress-line"><span /></div>
                <small className="progress-copy">1 of 3 ready</small>
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
                <div><p className="eyebrow">NEEDS A GUARDIAN</p><h2>Band physical form</h2><p>Matt can complete this by Friday, July 24.</p></div>
                <button className="secondary-button">Ask Matt</button>
              </section>
            </div>
          )}
        </section>
      </div>

      <footer className="demo-footer"><span><Icon name="shield" /> Private by design</span><span>Homeroom is a Build Week prototype using fictional student data.</span></footer>
    </main>
  );
}
