"use client";

import { useEffect, useRef, useState } from "react";

import type { ProjectedPriority, StudentSourceProjection } from "../../lib/domain/student-source-projection";
import type { FocusBlockRecord } from "../../lib/storage/focus-block-store";
import styles from "./student-activity-history.module.css";

export function StudentActivityHistory({
  focusBlocks,
  projection,
  onResume,
  onRestart
}: {
  focusBlocks: readonly FocusBlockRecord[];
  projection: StudentSourceProjection;
  onResume: (priority: ProjectedPriority, session: FocusBlockRecord) => void;
  onRestart: (priority: ProjectedPriority) => void;
}) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const activityButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!activityOpen) return;
    const drawer = drawerRef.current;
    const activityButton = activityButtonRef.current;
    const closeButton = drawer?.querySelector<HTMLButtonElement>("button[aria-label='Close activity']");
    closeButton?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setActivityOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      ));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      activityButton?.focus();
    };
  }, [activityOpen]);
  if (focusBlocks.length === 0) return null;

  function row(session: FocusBlockRecord) {
    const currentPriority = projection.priorities.find((item) => item.id === session.taskId) ?? null;
    const currentStatus = projection.courseworkStatuses?.find((item) => item.taskId === session.taskId);
    const sourceStatus = currentStatus?.label ?? session.sourceStatus;
    const partial = session.completedChunkCount < session.plannedChunkCount;
    const elapsedMinutes = Math.max(1, Math.round(session.elapsedSeconds / 60));
    const date = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: projection.context.timeZone
    }).format(new Date(session.completedAt));
    return (
      <li key={session.id} className={styles.row}>
        <div className={styles.icon} aria-hidden="true">✓</div>
        <div className={styles.summary}>
          <strong>{session.taskTitle}</strong>
          <span>{session.courseName} · {elapsedMinutes} min worked · {session.completedChunkCount} of {session.plannedChunkCount} steps</span>
        </div>
        <span className={`${styles.status} ${currentStatus?.isSourceComplete ? styles.sourceComplete : ""}`}>
          {sourceStatus}
        </span>
        {currentPriority ? (
          <button
            type="button"
            onClick={() => partial ? onResume(currentPriority, session) : onRestart(currentPriority)}
          >{partial ? "Resume session" : "Work on it again"}</button>
        ) : (
          <button
            type="button"
            aria-expanded={reviewingId === session.id}
            onClick={() => setReviewingId((current) => current === session.id ? null : session.id)}
          >Review session</button>
        )}
        {reviewingId === session.id && (
          <div className={styles.review}>
            <span>{date}</span>
            <span>{session.selectedMinutes}-minute timebox</span>
            <span>{sourceStatus}</span>
            <small>This is Homeroom session history. The school source controls submission status.</small>
          </div>
        )}
      </li>
    );
  }

  const latest = focusBlocks[0]!;
  return (
    <section className={styles.history} aria-labelledby="student-continuity-title">
      <header>
        <div>
          <p>PICK UP WHERE YOU LEFT OFF</p>
          <h2 id="student-continuity-title">Your last focus session</h2>
        </div>
        <button ref={activityButtonRef} type="button" aria-haspopup="dialog" onClick={() => setActivityOpen(true)}>View activity</button>
      </header>
      <ul>{row(latest)}</ul>
      {activityOpen && (
        <div className={styles.overlay} role="presentation" onMouseDown={() => setActivityOpen(false)}>
          <section
            ref={drawerRef}
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-activity-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div><p>ACTIVITY</p><h2 id="student-activity-title">Saved focus sessions</h2></div>
              <button type="button" onClick={() => setActivityOpen(false)} aria-label="Close activity">×</button>
            </header>
            <p className={styles.boundary}>Homeroom progress is shown here. Your school source still controls submission status.</p>
            <ul>{focusBlocks.map(row)}</ul>
          </section>
        </div>
      )}
    </section>
  );
}
