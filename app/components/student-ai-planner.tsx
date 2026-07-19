"use client";

import { useState } from "react";

import styles from "./student-ai-planner.module.css";

export const STUDENT_PLANNER_ENDPOINTS = Object.freeze({
  propose: "/api/morning-plan",
  approve: "/api/morning-plan/approve",
  refresh: "/api/plan-update",
  approveRefresh: "/api/plan-update/approve"
});

interface Plan {
  title: string;
  intro: string;
  steps: Array<{ time: string; title: string; detail: string; sourceLabel: string }>;
  guardianNote: string;
  encouragement: string;
  approvalPrompt: string;
}

interface PlanProposal {
  plan: Plan;
  approval: { actionId: string; receipt: string; expiresAt: string; planVersion: number };
  proof: { model: string; responseIds: string[]; sourceFingerprint: string; mode: "live" };
}

interface LiveSavedPlan {
  saved: true;
  planVersion: number;
  savedAt: string;
  sourceFingerprint: string;
  proof: { approvalId: string; argsHash: string };
}

interface LivePlanRevision {
  revision: {
    change: { title: string; summary: string; sourceLabel: string };
    plan: Plan;
  };
  approval: { actionId: string; receipt: string; expiresAt: string; planVersion: number };
  proof: { model: string; responseIds: string[]; sourceFingerprint: string; mode: "live" };
}

function clock(value: string): string {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

function responseError(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object" || !("error" in value)) return fallback;
  const error = value.error;
  if (!error || typeof error !== "object" || !("message" in error)) return fallback;
  return typeof error.message === "string" ? error.message : fallback;
}

function isObjectWith(value: unknown, key: string): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && key in value);
}

export interface StudentAIPlannerProps {
  csrfToken: string;
  studentName?: string;
  onOpenLearningRoom?: (courseId: "course_algebra_1") => void;
}

/**
 * The production student planner. Practice, family help, tasks, and Learning
 * remain independently available in navigation; none is a prerequisite here.
 */
export function StudentAIPlanner({ csrfToken, studentName = "Emily" }: StudentAIPlannerProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [revision, setRevision] = useState<LivePlanRevision | null>(null);
  const [saved, setSaved] = useState<LiveSavedPlan | null>(null);

  async function post(path: string, body: unknown, fallback: string): Promise<unknown> {
    if (!csrfToken) throw new Error("Start your student session first.");
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
      body: JSON.stringify(body)
    });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(responseError(data, fallback));
    return data;
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "That step is unavailable right now."); }
    finally { setBusy(null); }
  }

  function buildPlan() {
    void run("plan", async () => {
      const data = await post(STUDENT_PLANNER_ENDPOINTS.propose, {}, "Unable to build your live plan.");
      if (!isObjectWith(data, "plan")) throw new Error("Homeroom returned an incomplete plan.");
      setProposal(data as unknown as PlanProposal);
      setRevision(null);
    });
  }

  function refreshPlan() {
    void run("refresh", async () => {
      const data = await post(STUDENT_PLANNER_ENDPOINTS.refresh, {}, "Unable to refresh your live plan.");
      if (!isObjectWith(data, "revision")) throw new Error("Homeroom returned an incomplete update.");
      setRevision(data as unknown as LivePlanRevision);
      setProposal(null);
    });
  }

  function savePlan(candidate: PlanProposal | LivePlanRevision) {
    const approval = candidate.approval;
    const path = "revision" in candidate
      ? STUDENT_PLANNER_ENDPOINTS.approveRefresh
      : STUDENT_PLANNER_ENDPOINTS.approve;
    void run("save", async () => {
      const data = await post(path, {
        actionId: approval.actionId,
        receipt: approval.receipt
      }, "Unable to save this plan.");
      if (!isObjectWith(data, "saved")) throw new Error("Homeroom could not confirm the saved plan.");
      setSaved(data as unknown as LiveSavedPlan);
      setProposal(null);
      setRevision(null);
    });
  }

  const visiblePlan = proposal?.plan ?? revision?.revision.plan ?? null;

  return (
    <section className={styles.planner} aria-labelledby="ai-planner-title">
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>LIVE DAY PLANNER · STUDENT CONTROLLED</p>
          <h2 id="ai-planner-title">Plan one school day.</h2>
          <p>Homeroom reads your connected classes, assignments, school dates, and activities, then proposes four manageable steps. You choose whether to save them.</p>
        </div>
        <span className={styles.trustBadge}>♢ Read only · Private by design</span>
      </div>

      <article className={styles.focusCard}>
        {!visiblePlan && !saved && (
          <>
            <span className={styles.focusIcon}>◷</span>
            <p className={styles.eyebrow}>ONE USEFUL PLAN, NOT A REQUIRED PATH</p>
            <h3>Turn today’s live sources into a small plan</h3>
            <p>You can accept the suggestion, ask for another option, or leave and choose any task, class, or Learning Room yourself.</p>
            <button type="button" onClick={buildPlan} disabled={busy !== null}>
              {busy === "plan" ? "Reading your connected sources…" : "Suggest a plan for today"}
            </button>
          </>
        )}

        {visiblePlan && (
          <div className={styles.proposal}>
            {revision && <div className={styles.boundary}>{revision.revision.change.summary}</div>}
            <h3>{visiblePlan.title}</h3>
            <p>{visiblePlan.intro}</p>
            <ol className={styles.timeline}>
              {visiblePlan.steps.map((step) => (
                <li key={`${step.time}-${step.title}`}>
                  <time>{clock(step.time)}</time><i />
                  <span><strong>{step.title}</strong><small>{step.detail}</small><em>{step.sourceLabel}</em></span>
                </li>
              ))}
            </ol>
            <blockquote>{visiblePlan.encouragement}</blockquote>
            <div className={styles.studentDecision}>
              <span>
                <strong>Does this feel useful?</strong>
                <small>Saving keeps these exact steps in Homeroom. It never edits Classroom or a connected calendar.</small>
              </span>
              <button type="button" onClick={() => savePlan(revision ?? proposal!)} disabled={busy !== null}>
                {busy === "save" ? "Saving your choice…" : "Use this plan"}
              </button>
            </div>
            <div className={styles.actionRow}>
              <button className={styles.secondary} type="button" onClick={refreshPlan} disabled={busy !== null}>
                {busy === "refresh" ? "Building another option…" : "Show me another option"}
              </button>
            </div>
            <details className={styles.proofDetails}>
              <summary>How Homeroom made this proposal</summary>
              <p>It used the authenticated live projection only. School text is treated as untrusted data, the AI cannot write to a source, and nothing is saved without this exact approval.</p>
            </details>
          </div>
        )}

        {saved && (
          <div className={styles.celebration}>
            <i>✓</i>
            <p className={styles.eyebrow}>PLAN VERSION {saved.planVersion} SAVED</p>
            <h3>{studentName}, your plan is ready.</h3>
            <p>You can follow it, refresh it from the latest sources, or ignore it and choose something else.</p>
            <button type="button" onClick={refreshPlan} disabled={busy !== null}>
              {busy === "refresh" ? "Checking your sources…" : "Refresh from latest sources"}
            </button>
          </div>
        )}
      </article>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
