"use client";

import { useEffect, useState } from "react";

import type { StudentSourceProjection } from "../../lib/domain/student-source-projection";
import styles from "./student-planning-board.module.css";

export type StudentPlanningView = "today" | "week";

function TodayView({
  projection,
  onOpenTask,
  onOpenPlanner,
  completedPriorityIds = [],
  presentation = "page"
}: {
  projection: StudentSourceProjection;
  onOpenTask?: (priority: StudentSourceProjection["priorities"][number]) => void;
  onOpenPlanner?: () => void;
  completedPriorityIds?: readonly string[];
  presentation?: "page" | "workspace";
}) {
  const choices = projection.priorities.filter((item) => !completedPriorityIds.includes(item.id));
  const [choiceIndex, setChoiceIndex] = useState(0);
  const priority = choices[choiceIndex % Math.max(1, choices.length)] ?? null;

  if (!priority) {
    return (
      <section className={`${styles.board} ${styles.todayBoard} ${presentation === "workspace" ? styles.workspaceBoard : ""}`} aria-labelledby="today-focus-title">
        <header className={styles.calmHeader}>
          <p>TODAY</p>
          <h2 id="today-focus-title">You’re caught up.</h2>
          <span>No unfinished Classroom work needs your attention right now.</span>
        </header>
        <div className={styles.doneState}>
          <span aria-hidden="true">✓</span>
          <strong>Nothing to decide.</strong>
          <p>Check your Calendar or choose a short practice when you feel ready.</p>
          {onOpenPlanner && <button type="button" onClick={onOpenPlanner}>Plan today</button>}
        </div>
      </section>
    );
  }

  const nextChunks = priority.chunks.slice(1, 3);
  const firstChunk = priority.chunks[0];

  return (
    <section className={`${styles.board} ${styles.todayBoard} ${presentation === "workspace" ? styles.workspaceBoard : ""}`} aria-labelledby={presentation === "workspace" ? "today-priority-title" : "today-focus-title"}>
      {presentation === "page" && (
        <header className={styles.calmHeader}>
          <p>TODAY</p>
          <h2 id="today-focus-title">One thing at a time.</h2>
          <span>Here’s the next useful step.</span>
          {choiceIndex > 0 && <span>You chose an alternative. The original recommendation is still available.</span>}
        </header>
      )}

      <article className={styles.primaryFocus}>
        <div className={styles.primaryTopline}>
          <span className={`${styles.urgency} ${styles[priority.urgency.visualToken]}`}>{priority.urgency.label}</span>
          <span className={styles.timeBadge} aria-label={`${priority.effort.recommendedTimeboxMinutes} minute focus block`}>
            <strong>{priority.effort.recommendedTimeboxMinutes}</strong><small>MIN</small>
          </span>
        </div>
        <p className={styles.startLabel}>Start here</p>
        <h3 id={presentation === "workspace" ? "today-priority-title" : undefined}>{priority.title}</h3>
        <span className={styles.courseLabel}>{priority.course.name}</span>
        <p className={styles.priorityReason}>{priority.rationale.signals.join(" · ")}.</p>
        {priority.directions && <p className={styles.taskSummary}><strong>What it is:</strong> {priority.directions}</p>}

        {firstChunk && (
          <div className={styles.firstStep}>
            <span aria-hidden="true">1</span>
            <div><small>YOUR FIRST MOVE</small><strong>{firstChunk.action}</strong></div>
            <em>{firstChunk.minutes} min</em>
          </div>
        )}

        <div className={styles.primaryActions}>
          {onOpenTask && (
            <button className={styles.focusButton} type="button" onClick={() => onOpenTask(priority)}>Start this assignment <span aria-hidden="true">→</span></button>
          )}
          {choices.length > 1 && (
            <button type="button" onClick={() => setChoiceIndex((current) => (current + 1) % choices.length)}>Show me another option</button>
          )}
          {presentation === "workspace" && onOpenPlanner && (
            <button className={styles.planButton} type="button" aria-label="Build today’s live plan" onClick={onOpenPlanner}>Plan my day</button>
          )}
        </div>
        {presentation === "workspace" && choiceIndex > 0 && <p className={styles.workspaceChoiceNotice}>You chose another option. The first recommendation is still available.</p>}
      </article>

      {presentation === "page" && nextChunks.length > 0 && (
        <section className={styles.nextPreview} aria-labelledby="next-preview-title">
          <div><p>NEXT</p><h3 id="next-preview-title">Then, if you want</h3></div>
          <ol>
            {nextChunks.map((chunk) => (
              <li key={chunk.id} data-next-item={chunk.order}>
                <span>{chunk.order}</span>
                <div><strong>{chunk.label}</strong><small>{chunk.action}</small></div>
                <em>{chunk.minutes}m</em>
              </li>
            ))}
          </ol>
        </section>
      )}

      {presentation === "page" && onOpenPlanner && (
        <section className={styles.routineCard} aria-labelledby="day-routine-title">
          <span aria-hidden="true">☀</span>
          <div>
            <small>PLAN YOUR DAY</small>
            <h3 id="day-routine-title">Want help fitting today together?</h3>
            <p>Put your assignments and events into four simple steps.</p>
          </div>
          <button type="button" aria-label="Build today’s live plan" onClick={onOpenPlanner}>Plan today</button>
        </section>
      )}

    </section>
  );
}

function WeekView({ projection }: { projection: StudentSourceProjection }) {
  return (
    <section className={`${styles.board} ${styles.weekBoard}`} aria-labelledby="week-title">
      <header className={styles.calmHeader}>
        <p>WEEK</p>
        <h2 id="week-title">Your week at a glance.</h2>
        <span>Look ahead here—then return to Today for just one next step.</span>
      </header>
      <div className={styles.weekGrid}>
        {projection.week.days.map((day) => (
          <article className={day.date === projection.context.localDate ? styles.currentDay : ""} key={day.date}>
            <div>
              <strong aria-label={day.label}>
                <span>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</span>
                <small>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</small>
              </strong>
              <span>{day.items.length}</span>
            </div>
            {day.items.length === 0 ? <p>Clear</p> : day.items.slice(0, 3).map((item) => (
              <div className={styles.weekItem} key={item.id}>
                <i className={styles[item.visualToken]} />
                <span><strong>{item.title}</strong><small>{item.timeLabel}</small></span>
              </div>
            ))}
          </article>
        ))}
      </div>
      <div className={styles.skillReminder}>
        <span><i>◷</i><strong>Plan the time</strong><small>Notice your busy days.</small></span>
        <span><i>▦</i><strong>Set up the work</strong><small>Group tasks by day.</small></span>
        <span><i>1</i><strong>Choose what matters</strong><small>Return to Today for the first step.</small></span>
      </div>
    </section>
  );
}

export function StudentPlanningBoardView({
  projection,
  view = "today",
  onOpenTask,
  onOpenPlanner,
  completedPriorityIds,
  presentation = "page"
}: {
  projection: StudentSourceProjection;
  view?: StudentPlanningView;
  onOpenTask?: (priority: StudentSourceProjection["priorities"][number]) => void;
  onOpenPlanner?: () => void;
  completedPriorityIds?: readonly string[];
  presentation?: "page" | "workspace";
}) {
  return view === "week"
    ? <WeekView projection={projection} />
    : <TodayView projection={projection} onOpenTask={onOpenTask} onOpenPlanner={onOpenPlanner} completedPriorityIds={completedPriorityIds} presentation={presentation} />;
}

export function StudentPlanningBoard({
  csrfToken,
  view = "today",
  onOpenTask,
  onOpenPlanner,
  completedPriorityIds
}: {
  csrfToken: string;
  view?: StudentPlanningView;
  onOpenTask?: (priority: StudentSourceProjection["priorities"][number]) => void;
  onOpenPlanner?: () => void;
  completedPriorityIds?: readonly string[];
}) {
  const [projection, setProjection] = useState<StudentSourceProjection | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!csrfToken) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/student/projection", {
          method: "POST",
          headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
          body: "{}",
          signal: controller.signal
        });
        const body = await response.json() as StudentSourceProjection | { error?: { message?: string } };
        if (!response.ok || !("today" in body)) {
          throw new Error("error" in body ? body.error?.message : "Unable to build the live school plan.");
        }
        setProjection(body);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Unable to build the live school plan.");
      }
    })();
    return () => controller.abort();
  }, [csrfToken]);

  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!projection) return <section className={styles.loading} aria-live="polite">Finding one clear next step…</section>;
  return <StudentPlanningBoardView projection={projection} view={view} onOpenTask={onOpenTask} onOpenPlanner={onOpenPlanner} completedPriorityIds={completedPriorityIds} />;
}
