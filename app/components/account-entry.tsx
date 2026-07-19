"use client";

import { useEffect, useState } from "react";

import styles from "./account-entry.module.css";

export function AccountEntry() {
  const [status, setStatus] = useState<"idle" | "student" | "guardian" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
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

  return (
    <main className={styles.shell}>
      <header className={styles.brand}><span>✦</span><strong>homeroom</strong></header>
      <section className={styles.card} aria-labelledby="account-entry-title">
        <p className={styles.eyebrow}>Verified household access</p>
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
        <p className={styles.boundary}><span aria-hidden="true">◇</span> Google verifies identity first. Student and guardian roles stay separate from Classroom permissions.</p>
        {message && <p className={styles.error} role="alert">{message}</p>}
      </section>
    </main>
  );
}
