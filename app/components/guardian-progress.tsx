import type { GuardianProgressProjection } from "../../lib/domain/guardian-progress";
import styles from "./guardian-progress.module.css";

function sessionDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function GuardianProgress({ progress }: { progress: GuardianProgressProjection }) {
  return (
    <section className={styles.card} id="student-progress" aria-labelledby="guardian-progress-title" tabIndex={-1}>
      <header>
        <div>
          <p>STUDENT PROGRESS</p>
          <h2 id="guardian-progress-title">{progress.student.name}’s progress</h2>
          <span>School tasks and Homeroom focus sessions, without private work.</span>
        </div>
        <div className={styles.summary} aria-label="Progress summary">
          <span><strong>{progress.summary.openTaskCount}</strong> open tasks</span>
          <span><strong>{progress.summary.dueSoonCount}</strong> due soon</span>
          <span><strong>{progress.summary.minutesFocused}</strong> min focused</span>
        </div>
      </header>

      <div className={styles.columns}>
        <section aria-labelledby="guardian-upcoming-tasks-title">
          <div className={styles.sectionHead}>
            <h3 id="guardian-upcoming-tasks-title">Upcoming tasks</h3>
            <span>From connected school sources</span>
          </div>
          {progress.tasks.length === 0 ? (
            <p className={styles.empty}>No current school tasks are connected.</p>
          ) : (
            <ul className={styles.list}>
              {progress.tasks.slice(0, 5).map((task) => (
                <li key={task.taskId}>
                  <div><strong>{task.title}</strong><span>{task.courseName}</span></div>
                  <div><strong>{task.dueLabel}</strong><span>{task.sourceStatus}</span></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="guardian-recent-focus-title">
          <div className={styles.sectionHead}>
            <h3 id="guardian-recent-focus-title">Recent focus</h3>
            <span>Homeroom session progress</span>
          </div>
          {progress.recentSessions.length === 0 ? (
            <p className={styles.empty}>No saved focus sessions yet.</p>
          ) : (
            <ul className={styles.list}>
              {progress.recentSessions.slice(0, 5).map((session) => (
                <li key={session.id}>
                  <div><strong>{session.taskTitle}</strong><span>{session.courseName} · {sessionDate(session.occurredAt)}</span></div>
                  <div><strong>{session.completedStepCount} of {session.plannedStepCount} steps</strong><span>{session.minutesFocused} min · {session.sourceStatus}</span></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer>
        <strong>Summary, not surveillance.</strong>
        <span>Private check-ins, chats, drafts, and answers stay with {progress.student.name}.</span>
      </footer>
    </section>
  );
}
