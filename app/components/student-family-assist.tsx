"use client";

import { useState } from "react";

import type { ProjectedGuardianAssist } from "../../lib/domain/student-source-projection";
import styles from "./student-family-assist.module.css";

interface ReminderPreview {
  preview: {
    title: string;
    message: string;
    task: { label: string; dueAt: string };
    recipient: { name: string };
  };
  approval: { actionId: string; receipt: string };
}

interface ReminderSent {
  sent: true;
  recipient: string;
  channel: string;
  sentAt: string;
}

function message(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object" || !("error" in value)) return fallback;
  const error = value.error;
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback;
}

export function StudentFamilyAssist({
  csrfToken,
  candidate
}: {
  csrfToken: string;
  candidate: ProjectedGuardianAssist | null;
}) {
  const [status, setStatus] = useState<"idle" | "previewing" | "ready" | "sending" | "sent" | "error">("idle");
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [sent, setSent] = useState<ReminderSent | null>(null);
  const [error, setError] = useState("");

  async function prepare() {
    setStatus("previewing");
    setError("");
    try {
      const response = await fetch("/api/family/reminder/preview", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ taskId: candidate?.taskId })
      });
      const data = await response.json() as ReminderPreview | { error?: { message?: string } };
      if (!response.ok || !("preview" in data)) throw new Error(message(data, "Unable to prepare the message."));
      setPreview(data);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to prepare the message.");
      setStatus("error");
    }
  }

  async function send() {
    if (!preview) return;
    setStatus("sending");
    setError("");
    try {
      const response = await fetch("/api/family/reminder/send", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ actionId: preview.approval.actionId, receipt: preview.approval.receipt })
      });
      const data = await response.json() as ReminderSent | { error?: { message?: string } };
      if (!response.ok || !("sent" in data)) throw new Error(message(data, "Unable to send the message."));
      setSent(data);
      setStatus("sent");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send the message.");
      setStatus("error");
    }
  }

  if (!candidate) return null;

  return (
    <details className={styles.assist}>
      <summary><span aria-hidden="true">◇</span><strong>Something Matt may need to handle</strong><small>Homeroom noticed a guardian-only step. You decide whether to ask.</small></summary>
      <div className={styles.body}>
        {status === "sent" && sent ? (
          <div className={styles.sent}><span aria-hidden="true">✓</span><div><strong>Delivered to Matt’s Homeroom inbox</strong><small>Only the approved request was sent.</small></div></div>
        ) : preview ? (
          <>
            <p className={styles.label}>EXACT MESSAGE PREVIEW · NOT SENT YET</p>
            <h3>{preview.preview.title}</h3>
            <p>{preview.preview.message}</p>
            <div className={styles.boundary}><span>To: {preview.preview.recipient.name}</span><span>Private schoolwork stays with Emily</span></div>
            <button type="button" onClick={send} disabled={status === "sending"}>{status === "sending" ? "Sending approved message…" : "Approve and notify Matt"}</button>
          </>
        ) : (
          <>
            <p className={styles.label}>POSSIBLE GUARDIAN STEP · YOU DECIDE</p>
            <h3>{candidate.title}</h3>
            <p>{candidate.reason} Homeroom can prepare a short reminder without sharing answers, drafts, attempts, or private coaching.</p>
            <button type="button" onClick={prepare} disabled={status === "previewing"}>{status === "previewing" ? "Preparing exact message…" : "Ask Matt about this"}</button>
          </>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </details>
  );
}
