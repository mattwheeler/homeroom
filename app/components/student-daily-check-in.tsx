"use client";

import { useMemo, useState } from "react";

import {
  buildStudentDailyCheckIn,
  type StudentCheckInAction,
  type StudentCheckInChoice
} from "../../lib/domain/student-daily-check-in";
import type { StudentSourceProjection } from "../../lib/domain/student-source-projection";
import styles from "./student-daily-check-in.module.css";

type FocusState = "ready" | "scattered" | "low_energy";

const focusChoices: Array<{ id: FocusState; label: string; icon: string }> = [
  { id: "ready", label: "Ready", icon: "●" },
  { id: "scattered", label: "A little scattered", icon: "◌" },
  { id: "low_energy", label: "Low energy", icon: "◒" }
];

function supportiveLine(value: FocusState | null): string {
  if (value === "scattered") return "That’s okay. Homeroom will keep only one first step in view.";
  if (value === "low_energy") return "Thanks for saying so. A short start is enough for now.";
  if (value === "ready") return "Great. Start small, then decide what comes next.";
  return "Pick the closest answer. There is no wrong choice.";
}

function ChoiceCard({ choice, onAction, recommended = false }: {
  choice: StudentCheckInChoice;
  onAction?: (action: StudentCheckInAction) => void;
  recommended?: boolean;
}) {
  return (
    <article className={styles.choice} data-tone={choice.visualToken} data-recommended={recommended || undefined}>
      <span className={styles.choiceMarker} aria-hidden="true" />
      <div>
        <p>{choice.eyebrow}</p>
        <h2>{choice.title}</h2>
        <span>{choice.detail}</span>
      </div>
      <strong>{choice.timeLabel}</strong>
      <button
        type="button"
        disabled={choice.action.kind === "rest"}
        onClick={() => onAction?.(choice.action)}
      >
        {choice.actionLabel}<span aria-hidden="true">→</span>
      </button>
    </article>
  );
}

export function StudentDailyCheckIn({ studentName, projection, csrfToken, now, onAction }: {
  studentName: string;
  projection: StudentSourceProjection;
  csrfToken?: string;
  now?: Date;
  onAction?: (action: StudentCheckInAction) => void;
}) {
  const [focus, setFocus] = useState<FocusState | null>(null);
  const [message, setMessage] = useState("");
  const [aiStatus, setAiStatus] = useState<"idle" | "sending" | "complete" | "error">("idle");
  const [aiReply, setAiReply] = useState<{
    acknowledgement: string;
    nextStepLead: string;
    suggestedAction: "start_recommended" | "open_planner" | "take_two_minutes" | "ask_trusted_adult";
  } | null>(null);
  const [aiError, setAiError] = useState("");
  const checkIn = useMemo(
    () => buildStudentDailyCheckIn({ studentName, projection, now }),
    [now, projection, studentName]
  );

  async function sendCheckIn() {
    if (!focus || !message.trim() || !csrfToken || aiStatus === "sending") return;
    setAiStatus("sending");
    setAiError("");
    try {
      const response = await fetch("/api/student/check-in", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ focusState: focus, message: message.trim() })
      });
      const data = await response.json() as {
        reply?: {
          acknowledgement?: unknown;
          nextStepLead?: unknown;
          suggestedAction?: unknown;
        };
        error?: { message?: string };
      };
      if (
        !response.ok ||
        typeof data.reply?.acknowledgement !== "string" ||
        typeof data.reply.nextStepLead !== "string" ||
        !["start_recommended", "open_planner", "take_two_minutes", "ask_trusted_adult"].includes(String(data.reply.suggestedAction))
      ) {
        throw new Error(data.error?.message ?? "Homeroom could not respond just yet.");
      }
      setAiReply(data.reply as NonNullable<typeof aiReply>);
      setAiStatus("complete");
    } catch (caught) {
      setAiStatus("error");
      setAiError(caught instanceof Error ? caught.message : "Homeroom could not respond just yet.");
    }
  }

  function useAiSuggestion() {
    if (!aiReply) return;
    if (aiReply.suggestedAction === "open_planner") {
      onAction?.({ kind: "planner" });
      return;
    }
    if (aiReply.suggestedAction !== "ask_trusted_adult") onAction?.(checkIn.recommended.action);
  }

  return (
    <section className={styles.checkIn} aria-labelledby="student-daily-check-in-title">
      <div className={styles.heading}>
        <div>
          <p>YOUR LIVE CHECK-IN</p>
          <h1 id="student-daily-check-in-title">{checkIn.greeting}</h1>
          <span>{checkIn.context}</span>
        </div>
        <div className={styles.sourceSignal} aria-label="Based on connected school sources">
          <i aria-hidden="true">✓</i><span><strong>Live sources checked</strong><small>No guessed deadlines or events</small></span>
        </div>
      </div>

      <fieldset className={styles.focus}>
        <legend>How is your focus right now?</legend>
        <div>
          {focusChoices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              aria-pressed={focus === choice.id}
              onClick={() => setFocus(choice.id)}
            ><span aria-hidden="true">{choice.icon}</span>{choice.label}</button>
          ))}
        </div>
        <p aria-live="polite">{supportiveLine(focus)}</p>
      </fieldset>

      <details className={styles.aiCheckIn}>
        <summary>Tell Homeroom what’s making it hard to start</summary>
        <div>
          <label htmlFor="student-check-in-message">One short message</label>
          <textarea
            id="student-check-in-message"
            value={message}
            maxLength={280}
            rows={3}
            disabled={!focus || aiStatus === "sending"}
            placeholder={focus ? "For example: I know what to do, but I can’t get started." : "Choose how your focus feels first."}
            onChange={(event) => setMessage(event.target.value)}
          />
          <div><span>{message.length}/280</span><button type="button" disabled={!focus || !message.trim() || !csrfToken || aiStatus === "sending"} onClick={() => void sendCheckIn()}>{aiStatus === "sending" ? "Thinking…" : "Check in with Homeroom"}</button></div>
          {aiError && <p className={styles.aiError} role="alert">{aiError}</p>}
          {aiReply && (
            <section className={styles.aiReply} aria-live="polite">
              <p><strong>Homeroom</strong>{aiReply.acknowledgement}</p>
              <p>{aiReply.nextStepLead}</p>
              {aiReply.suggestedAction === "ask_trusted_adult"
                ? <strong>Please tell a trusted adult near you now.</strong>
                : <button type="button" onClick={useAiSuggestion}>{aiReply.suggestedAction === "open_planner" ? "Open the small planner" : aiReply.suggestedAction === "take_two_minutes" ? "Try a two-minute start" : "Start the recommended step"}</button>}
            </section>
          )}
        </div>
      </details>

      <ChoiceCard choice={checkIn.recommended} onAction={onAction} recommended />

      <details className={styles.alternatives}>
        <summary>Show {checkIn.alternatives.length} other choices</summary>
        <div>{checkIn.alternatives.map((choice) => (
          <ChoiceCard key={choice.id} choice={choice} onAction={onAction} />
        ))}</div>
      </details>
    </section>
  );
}
