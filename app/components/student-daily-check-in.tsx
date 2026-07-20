"use client";

import { useMemo, useState, type ReactNode } from "react";

import {
  buildStudentDailyCheckIn,
  type StudentCheckInAction,
  type StudentCheckInChoice
} from "../../lib/domain/student-daily-check-in";
import type { StudentSourceProjection } from "../../lib/domain/student-source-projection";
import styles from "./student-daily-check-in.module.css";

type FocusState = "ready" | "scattered" | "low_energy";
type SuggestedAction = "none" | "start_recommended" | "open_planner" | "take_two_minutes" | "ask_trusted_adult";

type ConversationTurn =
  | { id: string; role: "student"; text: string }
  | {
      id: string;
      role: "homeroom";
      message: string;
      followUpQuestion: string | null;
      suggestedAction: SuggestedAction;
      mode: "live" | "fallback" | "safety";
    };

const focusChoices: Array<{ id: FocusState; label: string; icon: string; prompt: string }> = [
  {
    id: "ready",
    label: "Ready",
    icon: "●",
    prompt: "I am feeling confident and ready to get started today."
  },
  {
    id: "scattered",
    label: "A little scattered",
    icon: "◌",
    prompt: "I am feeling a little scattered today, and I am not quite sure where to begin."
  },
  {
    id: "low_energy",
    label: "Low energy",
    icon: "◒",
    prompt: "I have low energy today, and it is affecting my ability to focus."
  }
];

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

export function StudentDailyCheckIn({ studentName, projection, csrfToken, now, onAction, primaryContent }: {
  studentName: string;
  projection: StudentSourceProjection;
  csrfToken?: string;
  now?: Date;
  onAction?: (action: StudentCheckInAction) => void;
  primaryContent?: ReactNode;
}) {
  const [focus, setFocus] = useState<FocusState | null>(null);
  const [message, setMessage] = useState("");
  const [composerOpen, setComposerOpen] = useState(!primaryContent);
  const [aiStatus, setAiStatus] = useState<"idle" | "sending" | "complete" | "error">("idle");
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [aiError, setAiError] = useState("");
  const checkIn = useMemo(
    () => buildStudentDailyCheckIn({ studentName, projection, now }),
    [now, projection, studentName]
  );

  async function sendCheckIn() {
    const studentMessage = message.trim();
    if (!studentMessage || !csrfToken || aiStatus === "sending") return;
    const history = conversation.slice(-10).map((turn) => turn.role === "student"
      ? { role: "student" as const, text: turn.text.slice(0, 500) }
      : {
          role: "homeroom" as const,
          text: [turn.message, turn.followUpQuestion].filter(Boolean).join(" ").slice(0, 500)
        });
    setConversation((current) => [...current, {
      id: `student-${Date.now()}`,
      role: "student",
      text: studentMessage
    }]);
    setMessage("");
    setAiStatus("sending");
    setAiError("");
    try {
      const response = await fetch("/api/student/check-in", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ focusState: focus, message: studentMessage, history })
      });
      const data = await response.json() as {
        reply?: {
          message?: unknown;
          followUpQuestion?: unknown;
          suggestedAction?: unknown;
        };
        proof?: { mode?: unknown };
        error?: { message?: string };
      };
      if (
        !response.ok ||
        typeof data.reply?.message !== "string" ||
        !(data.reply.followUpQuestion === null || typeof data.reply.followUpQuestion === "string") ||
        !["none", "start_recommended", "open_planner", "take_two_minutes", "ask_trusted_adult"].includes(String(data.reply.suggestedAction))
      ) {
        throw new Error(data.error?.message ?? "Homeroom could not respond just yet.");
      }
      const mode = ["live", "fallback", "safety"].includes(String(data.proof?.mode))
        ? data.proof?.mode as "live" | "fallback" | "safety"
        : "fallback";
      setConversation((current) => [...current, {
        id: `homeroom-${Date.now()}`,
        role: "homeroom",
        message: data.reply!.message as string,
        followUpQuestion: data.reply!.followUpQuestion as string | null,
        suggestedAction: data.reply!.suggestedAction as SuggestedAction,
        mode
      }]);
      setAiStatus("complete");
    } catch (caught) {
      setAiStatus("error");
      setAiError(caught instanceof Error ? caught.message : "Homeroom could not respond just yet.");
    }
  }

  function handleAiSuggestion(suggestedAction: SuggestedAction) {
    if (suggestedAction === "open_planner") {
      onAction?.({ kind: "planner" });
      return;
    }
    if (suggestedAction !== "none" && suggestedAction !== "ask_trusted_adult") {
      onAction?.(checkIn.recommended.action);
    }
  }

  function suggestionLabel(action: SuggestedAction): string {
    if (action === "open_planner") return "Open the small planner";
    if (action === "take_two_minutes") return "Open the first step";
    return "Start the recommended step";
  }

  function chooseFocusStarter(choice: (typeof focusChoices)[number]) {
    const isSelected = focus === choice.id;
    setFocus(isSelected ? null : choice.id);
    setComposerOpen(true);
    setMessage((current) => {
      if (isSelected) return current === choice.prompt ? "" : current;
      return choice.prompt;
    });
  }

  function openCustomCheckIn() {
    setFocus(null);
    setComposerOpen(true);
    setMessage((current) => focusChoices.some((choice) => choice.prompt === current) ? "" : current);
  }

  const showComposer = !primaryContent || composerOpen || conversation.length > 0 || aiStatus !== "idle" || Boolean(aiError);

  const coachingPanel = (
    <section className={styles.aiCheckIn} data-testid="today-coaching-panel" aria-labelledby="student-ai-check-in-title">
        <header>
          <div><p>PRIVATE CHECK-IN</p><h2 id="student-ai-check-in-title">Talk it through with Homeroom</h2></div>
          {conversation.length > 0 && <button type="button" onClick={() => { setConversation([]); setFocus(null); setMessage(""); setComposerOpen(!primaryContent); setAiError(""); }}>Start over</button>}
        </header>
        {conversation.length > 0 && (
          <div className={styles.conversation} role="log" aria-live="polite" aria-label="Conversation with Homeroom">
            {conversation.map((turn) => turn.role === "student" ? (
              <article key={turn.id} className={styles.studentTurn}><strong>You</strong><p>{turn.text}</p></article>
            ) : (
              <article key={turn.id} className={styles.homeroomTurn}>
                <div><strong>Homeroom</strong><span>{turn.mode === "live" ? "Check-in" : turn.mode === "safety" ? "Safety support" : "Quick support"}</span></div>
                <p>{turn.message}</p>
                {turn.followUpQuestion && <p>{turn.followUpQuestion}</p>}
                {turn.suggestedAction === "ask_trusted_adult"
                  ? <strong className={styles.trustedAdult}>Please tell a trusted adult near you now.</strong>
                  : turn.suggestedAction !== "none" && <button type="button" onClick={() => handleAiSuggestion(turn.suggestedAction)}>{suggestionLabel(turn.suggestedAction)}</button>}
              </article>
            ))}
            {aiStatus === "sending" && <article className={styles.thinking}><span aria-hidden="true">●</span><span aria-hidden="true">●</span><span aria-hidden="true">●</span><em>Homeroom is thinking</em></article>}
          </div>
        )}
        <form onSubmit={(event) => { event.preventDefault(); void sendCheckIn(); }}>
          <div className={styles.checkInPrompt}>How are you arriving today?</div>
          <p>Choose one if it helps. This private check-in is always optional.</p>
          <fieldset className={styles.focusStarters}>
            <legend>Conversation starters</legend>
            <div>
              {focusChoices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  aria-label={choice.label}
                  aria-pressed={focus === choice.id}
                  onClick={() => chooseFocusStarter(choice)}
                >
                  <span aria-hidden="true">{choice.icon}</span>
                  <strong>{choice.label}</strong>
                  {!primaryContent && <small>{choice.prompt}</small>}
                </button>
              ))}
              {primaryContent && (
                <button
                  type="button"
                  aria-label="Something else…"
                  aria-pressed={focus === null && composerOpen}
                  onClick={openCustomCheckIn}
                >
                  <span aria-hidden="true">＋</span>
                  <strong>Something else…</strong>
                </button>
              )}
            </div>
          </fieldset>
          {showComposer && (
            <div className={styles.composer}>
              <textarea
                id="student-check-in-message"
                aria-label="What would you like help with right now?"
                value={message}
                maxLength={500}
                rows={primaryContent ? 2 : 3}
                disabled={aiStatus === "sending"}
                placeholder={conversation.length > 0 ? "Reply to Homeroom…" : "For example: I know what to do, but I can’t get started."}
                onChange={(event) => setMessage(event.target.value)}
              />
              <div><span>{message.length}/500</span><button type="submit" disabled={!message.trim() || !csrfToken || aiStatus === "sending"}>{aiStatus === "sending" ? "Homeroom is thinking…" : "Talk to Homeroom"}</button></div>
              {aiError && <p className={styles.aiError} role="alert">{aiError}</p>}
            </div>
          )}
        </form>
      </section>
  );

  return (
    <section
      className={`${styles.checkIn} ${primaryContent ? styles.unifiedCheckIn : ""}`}
      data-testid={primaryContent ? "today-unified-workspace" : undefined}
      aria-labelledby="student-daily-check-in-title"
    >
      <div className={styles.heading}>
        <div>
          <p>TODAY</p>
          <h1 id="student-daily-check-in-title">{checkIn.greeting}</h1>
          <span>{checkIn.context}</span>
        </div>
        <div className={styles.sourceSignal} aria-label="Based on connected school sources">
          <i aria-hidden="true">✓</i><span><strong>School apps updated</strong><small>Assignments and dates checked</small></span>
        </div>
      </div>

      {primaryContent ? (
        <div className={styles.workspaceBody}>
          {coachingPanel}
          <div className={styles.primarySlot} data-testid="today-primary-column">{primaryContent}</div>
        </div>
      ) : (
        <>
          {coachingPanel}
          <ChoiceCard choice={checkIn.recommended} onAction={onAction} recommended />
          <details className={styles.alternatives}>
            <summary>Show {checkIn.alternatives.length} other choices</summary>
            <div>{checkIn.alternatives.map((choice) => (
              <ChoiceCard key={choice.id} choice={choice} onAction={onAction} />
            ))}</div>
          </details>
        </>
      )}
    </section>
  );
}
