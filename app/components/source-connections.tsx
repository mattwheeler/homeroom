"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { CourseId } from "../../lib/domain/learning-tracks";

export interface ConnectedCourse {
  externalId: string;
  name: string;
  section: string | null;
  trackCourseId: CourseId | null;
}

interface SourceConnection {
  provider: "google_classroom" | "band_ical";
  status: "active" | "error" | "revoked";
  displayName: string;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
}

interface Coursework {
  externalId: string;
  courseExternalId: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  submissionState: string | null;
  late: boolean | null;
}

interface CalendarEvent {
  uid: string;
  title: string;
  location: string | null;
  startsAt: string;
  allDay: boolean;
}

interface SourceSnapshot {
  connections: SourceConnection[];
  courses: ConnectedCourse[];
  coursework: Coursework[];
  events: CalendarEvent[];
}

const emptySnapshot: SourceSnapshot = {
  connections: [],
  courses: [],
  coursework: [],
  events: []
};

function apiError(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object" || !("error" in value)) return fallback;
  const error = value.error;
  if (!error || typeof error !== "object" || !("message" in error)) return fallback;
  return typeof error.message === "string" ? error.message : fallback;
}

function shortDate(value: string | null): string {
  if (!value) return "No due date";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
}

function eventDate(value: string, allDay: boolean): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(allDay ? {} : { hour: "numeric", minute: "2-digit" })
  }).format(parsed);
}

export function SourceConnections({
  csrfToken,
  onCoursesChanged
}: {
  csrfToken: string;
  onCoursesChanged(courses: ConnectedCourse[]): void;
}) {
  const [snapshot, setSnapshot] = useState<SourceSnapshot>(emptySnapshot);
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");

  async function readStatus(resultMessage = "") {
    if (!csrfToken) return;
    try {
      const response = await fetch("/api/integrations/status", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: "{}"
      });
      const data = await response.json() as SourceSnapshot | { error?: { message?: string } };
      if (!response.ok || !("courses" in data)) {
        throw new Error(apiError(data, "Unable to read connected sources."));
      }
      setSnapshot(data);
      onCoursesChanged(data.courses);
      if (resultMessage) setMessage(resultMessage);
      setStatus("ready");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to read connected sources.");
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!csrfToken) return;
    const timer = window.setTimeout(() => void readStatus(), 0);
    return () => window.clearTimeout(timer);
    // `readStatus` is intentionally scoped to the current CSRF-authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csrfToken]);

  const google = snapshot.connections.find((connection) => connection.provider === "google_classroom");
  const band = snapshot.connections.find((connection) => connection.provider === "band_ical");

  return (
    <section className="source-connections card" id="sources" aria-labelledby="sources-title">
      <header className="sources-header">
        <div>
          <p className="eyebrow">GUARDIAN-MANAGED · READ ONLY</p>
          <h2 id="sources-title">Guardian-managed school sources</h2>
          <p>Matt controls connections. Emily can use the imported classes, assignments, and events without changing source access.</p>
        </div>
        <span className="source-readonly-badge">No write permissions</span>
      </header>

      <div className="source-provider-grid">
        <article className="source-provider-card">
          <div className="source-provider-topline"><span>G</span><small>GOOGLE CLASSROOM</small></div>
          <h3>{google ? google.displayName : "Google Classroom not connected"}</h3>
          <p>Reads active classes, published coursework, due dates, and Emily&apos;s own submission state.</p>
          <span className="source-readonly-badge">{google ? "Connected by guardian" : "Guardian setup required"}</span>
          <small className="source-provider-foot">{google?.lastSyncAt ? `Last read ${new Date(google.lastSyncAt).toLocaleString()}` : "Matt can connect this in the guardian workspace"}</small>
        </article>

        <article className="source-provider-card band-source-card">
          <div className="source-provider-topline"><span>B</span><small>BAND CALENDAR</small></div>
          <h3>{band ? band.displayName : "BAND calendar not connected"}</h3>
          <p>Shows official BAND calendar events after a guardian adds the private export URL.</p>
          <span className="source-readonly-badge">{band ? "Connected by guardian" : "Guardian setup required"}</span>
          <small className="source-provider-foot">{band?.lastSyncAt ? `Last read ${new Date(band.lastSyncAt).toLocaleString()}` : "Matt can connect this in the guardian workspace"}</small>
        </article>
      </div>

      {message && <p className={`source-message ${status === "error" ? "error" : ""}`} role="status">{message}</p>}

      {(snapshot.courses.length > 0 || snapshot.coursework.length > 0 || snapshot.events.length > 0) && (
        <div className="source-snapshot" aria-live="polite">
          <section>
            <div className="source-snapshot-title"><h3>Active classes</h3><span>{snapshot.courses.length}</span></div>
            {snapshot.courses.slice(0, 8).map((course) => <article key={course.externalId}><strong>{course.name}</strong><small>{course.trackCourseId ? "Learning track ready" : "Visible · track mapping needed"}</small></article>)}
          </section>
          <section>
            <div className="source-snapshot-title"><h3>Upcoming coursework</h3><span>{snapshot.coursework.length}</span></div>
            {snapshot.coursework.slice(0, 5).map((work) => <article key={work.externalId}><strong>{work.title}</strong><small>{shortDate(work.dueDate)}{work.submissionState ? ` · ${work.submissionState.toLowerCase().replaceAll("_", " ")}` : ""}</small></article>)}
          </section>
          <section>
            <div className="source-snapshot-title"><h3>BAND events</h3><span>{snapshot.events.length}</span></div>
            {snapshot.events.slice(0, 5).map((event) => <article key={event.uid}><strong>{event.title}</strong><small>{eventDate(event.startsAt, event.allDay)}{event.location ? ` · ${event.location}` : ""}</small></article>)}
          </section>
        </div>
      )}
      <p className="source-boundary">Homeroom never posts, edits, submits, grades, or RSVPs. <Link href="/guardian#school-sources">Open guardian workspace</Link></p>
    </section>
  );
}
