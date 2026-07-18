"use client";

import { useEffect, useState, type FormEvent } from "react";

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
  const [status, setStatus] = useState<"idle" | "loading" | "connecting" | "syncing" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const [bandUrl, setBandUrl] = useState("");

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
    const result = new URLSearchParams(window.location.search).get("source");
    const resultMessage = result === "google-connected"
      ? "Google Classroom connected. Your active classes are ready."
      : result === "google-declined"
        ? "Google Classroom access was not granted. Nothing was connected."
        : result === "google-error"
          ? "Google Classroom could not finish connecting. Please try again."
          : result === "google-not-configured"
            ? "Google Classroom credentials still need to be added locally."
            : "";
    const timer = window.setTimeout(() => void readStatus(resultMessage), 0);
    return () => window.clearTimeout(timer);
    // `readStatus` is intentionally scoped to the current CSRF-authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csrfToken]);

  async function connectGoogle() {
    if (!csrfToken) return;
    setStatus("connecting");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/google/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: "{}"
      });
      const data = await response.json() as { authorizationUrl?: string; error?: { message?: string } };
      if (!response.ok || !data.authorizationUrl) {
        throw new Error(apiError(data, "Unable to begin Google authorization."));
      }
      const destination = new URL(data.authorizationUrl);
      if (destination.origin !== "https://accounts.google.com") {
        throw new Error("The Google authorization destination was not recognized.");
      }
      window.location.assign(destination.toString());
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to begin Google authorization.");
      setStatus("error");
    }
  }

  async function connectBand(event: FormEvent) {
    event.preventDefault();
    if (!csrfToken || !bandUrl.trim()) return;
    setStatus("connecting");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/band/connect", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ calendarUrl: bandUrl.trim(), displayName: "Emily's BAND calendar" })
      });
      const data = await response.json() as { connected?: boolean; eventCount?: number; error?: { message?: string } };
      if (!response.ok || !data.connected) {
        throw new Error(apiError(data, "Unable to connect the BAND calendar."));
      }
      setBandUrl("");
      setMessage(`BAND calendar connected with ${data.eventCount ?? 0} upcoming events.`);
      await readStatus();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to connect the BAND calendar.");
      setStatus("error");
    }
  }

  async function sync(provider: SourceConnection["provider"]) {
    if (!csrfToken) return;
    setStatus("syncing");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ provider })
      });
      const data = await response.json() as { synced?: boolean; recordCount?: number; error?: { message?: string } };
      if (!response.ok || !data.synced) throw new Error(apiError(data, "Unable to refresh this source."));
      setMessage(`Read-only source refreshed with ${data.recordCount ?? 0} current records.`);
      await readStatus();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to refresh this source.");
      setStatus("error");
    }
  }

  const google = snapshot.connections.find((connection) => connection.provider === "google_classroom");
  const band = snapshot.connections.find((connection) => connection.provider === "band_ical");
  const busy = status === "connecting" || status === "syncing" || status === "loading";

  return (
    <section className="source-connections card" id="sources" aria-labelledby="sources-title">
      <header className="sources-header">
        <div>
          <p className="eyebrow">LIVE SCHOOL SOURCES · READ ONLY</p>
          <h2 id="sources-title">Bring Emily&apos;s real schedule into Homeroom</h2>
          <p>Classes and coursework come from Google Classroom. BAND events arrive through BAND&apos;s official calendar export.</p>
        </div>
        <span className="source-readonly-badge">No write permissions</span>
      </header>

      <div className="source-provider-grid">
        <article className="source-provider-card">
          <div className="source-provider-topline"><span>G</span><small>GOOGLE CLASSROOM</small></div>
          <h3>{google ? google.displayName : "Connect Emily's classes"}</h3>
          <p>Reads active classes, published coursework, due dates, and Emily&apos;s own submission state.</p>
          {google ? (
            <button disabled={busy} onClick={() => void sync("google_classroom")}>{status === "syncing" ? "Refreshing…" : "Refresh Classroom"}</button>
          ) : (
            <button disabled={busy || !csrfToken} onClick={() => void connectGoogle()}>{status === "connecting" ? "Opening Google…" : "Connect Google Classroom"}</button>
          )}
          <small className="source-provider-foot">{google?.lastSyncAt ? `Last read ${new Date(google.lastSyncAt).toLocaleString()}` : "OAuth · 2 narrow read-only scopes"}</small>
        </article>

        <article className="source-provider-card band-source-card">
          <div className="source-provider-topline"><span>B</span><small>BAND CALENDAR</small></div>
          <h3>{band ? band.displayName : "Subscribe to Emily's band"}</h3>
          <p>Paste the private iCal URL from BAND’s Calendar → Export Band Calendars screen.</p>
          {band ? (
            <button disabled={busy} onClick={() => void sync("band_ical")}>{status === "syncing" ? "Refreshing…" : "Refresh BAND calendar"}</button>
          ) : (
            <form className="band-source-form" onSubmit={connectBand}>
              <label htmlFor="band-calendar-url">Private BAND calendar URL</label>
              <div><input id="band-calendar-url" type="url" inputMode="url" autoComplete="off" maxLength={2_048} placeholder="webcal://…band.us/…" value={bandUrl} onChange={(event) => setBandUrl(event.target.value)} /><button disabled={busy || !bandUrl.trim()}>Connect</button></div>
            </form>
          )}
          <small className="source-provider-foot">{band?.lastSyncAt ? `Last read ${new Date(band.lastSyncAt).toLocaleString()}` : "HTTPS only · band.us hosts only · redirects rechecked"}</small>
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
      <p className="source-boundary">Homeroom never posts, edits, submits, grades, or RSVPs in either provider.</p>
    </section>
  );
}
