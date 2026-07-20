"use client";

import { useEffect, useState } from "react";

import styles from "./account-entry.module.css";

export function AccountEntry() {
  const [status, setStatus] = useState<"idle" | "student" | "guardian" | "error">("idle");
  const [message, setMessage] = useState("");
  const [judgeCode, setJudgeCode] = useState("");
  const [judgeRole, setJudgeRole] = useState<"student" | "guardian" | null>(null);
  const [judgeOpen, setJudgeOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHydrated(true);
      const result = new URLSearchParams(window.location.search).get("auth");
      if (result === "declined") setMessage("Google sign-in was cancelled. Nothing was connected.");
      if (result === "error") setMessage("Google could not verify that account. Try the linked household account again.");
      if (result === "not-configured") setMessage("Google identity sign-in still needs its callback configuration.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function signIn(role: "student" | "guardian") {
    setStatus(role);
    setMessage("");
    try {
      const response = await fetch("/api/auth/google/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role })
      });
      const data = await response.json() as { authorizationUrl?: unknown; error?: { message?: string } };
      if (!response.ok || typeof data.authorizationUrl !== "string") {
        throw new Error(data.error?.message ?? "Google sign-in could not start.");
      }
      const destination = new URL(data.authorizationUrl);
      if (destination.origin !== "https://accounts.google.com") throw new Error("Google sign-in destination was not recognized.");
      window.location.assign(destination.toString());
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Google sign-in could not start.");
    }
  }

  async function openJudgeWorkspace(role: "student" | "guardian") {
    setJudgeRole(role);
    setMessage("");
    try {
      const response = await fetch("/api/auth/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, code: judgeCode })
      });
      const data = await response.json() as { redirectPath?: unknown; error?: { message?: string } };
      if (!response.ok || typeof data.redirectPath !== "string") {
        throw new Error(data.error?.message ?? "Build Week review access could not start.");
      }
      if (data.redirectPath !== "/student" && data.redirectPath !== "/guardian") {
        throw new Error("Build Week review destination was not recognized.");
      }
      window.location.assign(data.redirectPath);
    } catch (caught) {
      setJudgeRole(null);
      setMessage(caught instanceof Error ? caught.message : "Build Week review access could not start.");
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.brand}><span>✦</span><strong>homeroom</strong></header>
      <section className={styles.card} aria-labelledby="account-entry-title">
        <p className={styles.eyebrow}>Choose a profile</p>
        <h1 id="account-entry-title">Who is using Homeroom?</h1>
        <p className={styles.intro}>Choose your space. Student work and guardian controls stay separate.</p>
        <div className={styles.profiles}>
          <article className={styles.student}>
            <span className={styles.avatar}>E</span>
            <div><small>STUDENT</small><h2>Emily</h2><p>Grade 9 · Today, classes, calendar, and learning</p></div>
            <button type="button" onClick={() => void signIn("student")} disabled={status === "student" || status === "guardian"}>
              {status === "student" ? "Opening Google…" : "Sign in as Emily"} <span aria-hidden="true">→</span>
            </button>
          </article>
          <article className={styles.guardian}>
            <span className={styles.avatar}>M</span>
            <div><small>GUARDIAN</small><h2>Matt</h2><p>Learning support, safety, privacy, and school sources</p></div>
            <button type="button" onClick={() => void signIn("guardian")} disabled={status === "student" || status === "guardian"}>
              {status === "guardian" ? "Opening Google…" : "Sign in as Matt"} <span aria-hidden="true">→</span>
            </button>
          </article>
        </div>
        <p className={styles.boundary}><span aria-hidden="true">◇</span> Google sign-in keeps student and guardian spaces separate.</p>
        <div className={styles.judgeAccess}>
          <button
            type="button"
            className={styles.judgeToggle}
            aria-expanded={judgeOpen}
            aria-controls="build-week-judge-panel"
            onClick={() => setJudgeOpen((open) => !open)}
            disabled={!hydrated}
          >OpenAI Build Week judge access</button>
          {judgeOpen && <div id="build-week-judge-panel" className={styles.judgePanel}>
            <label htmlFor="judge-access-code">Review code</label>
            <p>Use the code in the private testing instructions. It opens the same fictional Emily and Matt journeys shown in the video.</p>
            <input
              id="judge-access-code"
              type="password"
              autoComplete="one-time-code"
              value={judgeCode}
              onChange={(event) => setJudgeCode(event.target.value)}
              disabled={judgeRole !== null}
            />
            <div>
              <button type="button" onClick={() => void openJudgeWorkspace("student")} disabled={!judgeCode || judgeRole !== null}>
                {judgeRole === "student" ? "Opening student view…" : "Open student view"}
              </button>
              <button type="button" onClick={() => void openJudgeWorkspace("guardian")} disabled={!judgeCode || judgeRole !== null}>
                {judgeRole === "guardian" ? "Opening guardian view…" : "Open guardian view"}
              </button>
            </div>
          </div>}
        </div>
        {message && <p className={styles.error} role="alert">{message}</p>}
      </section>
    </main>
  );
}
