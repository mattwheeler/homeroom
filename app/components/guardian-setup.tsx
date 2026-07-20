"use client";

import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";

import type {
  GuardianSetupSettings,
  GuardianSourceSummary,
  GuardianWorkspace
} from "../../lib/domain/guardian-setup-profile";
import {
  bandProgramSources,
  calendarFeedDisplayName
} from "../../lib/domain/band-program-sources";
import styles from "./guardian-setup.module.css";
import { GuardianInbox } from "./guardian-inbox";
import { GuardianProgress } from "./guardian-progress";
import {
  guardianNavigationItems,
  guardianSectionFromHash,
  nextGuardianNavigationIndex,
  sourceTypePresentation,
  supportedGuardianSourceTypes,
  type GuardianSectionId
} from "./guardian-workspace-model";

type WorkspaceStatus = "locked" | "loading" | "ready" | "saving" | "connecting" | "syncing" | "error";
type ExecutiveSkillKey = keyof GuardianSetupSettings["profile"]["executiveSkills"];
type Modality = GuardianSetupSettings["profile"]["learningModalities"][number];
type SourcePermissionKey = Exclude<keyof GuardianSetupSettings["sourcePermissions"], "managedBy">;

const skills: Array<{ key: ExecutiveSkillKey; label: string; verb: string; glyph: string }> = [
  { key: "timeManagement", label: "Time management", verb: "Plan the time", glyph: "◷" },
  { key: "organization", label: "Organization", verb: "Set up the work", glyph: "▦" },
  { key: "prioritization", label: "Prioritization", verb: "Choose what matters", glyph: "⚑" }
];

const modalityOptions: Array<{ value: Modality; label: string }> = [
  { value: "visual", label: "Visual" },
  { value: "interactive", label: "Hands-on" },
  { value: "worked_examples", label: "Worked examples" },
  { value: "verbal", label: "Talk it through" },
  { value: "reading_writing", label: "Reading & writing" }
];

const guardianCsrfStorageKey = "homeroom_guardian_csrf";

function googleResultMessage(result: string | null): string {
  switch (result) {
    case "google-connected": return "Google Classroom connected. Emily’s current classes and assignments are ready.";
    case "google-declined": return "Google Classroom access was not granted. Nothing was connected.";
    case "google-invalid-grant": return "Google rejected the one-time authorization grant. Start the connection again.";
    case "google-client-error": return "Google rejected Homeroom’s configured OAuth client.";
    case "google-token-rejected": return "Google rejected the token request. No credential was stored.";
    case "google-network-error": return "Google’s authorization service could not be reached.";
    case "google-response-error": return "Google returned an authorization response Homeroom could not validate.";
    case "google-provider-unavailable": return "Google authorization is temporarily unavailable.";
    case "google-classroom-error": return "Google approved access, but Classroom data could not be read.";
    case "google-storage-error": return "Google connected, but the encrypted connection could not be saved.";
    case "google-refresh-error": return "Google did not provide offline read access. Remove Homeroom from connected apps and retry.";
    case "google-not-configured": return "Google Classroom credentials are not configured for Homeroom yet.";
    case "google-oauth-error":
    case "google-error": return "Google Classroom could not finish connecting. Please try again.";
    default: return "";
  }
}

function Shield({ children }: { children?: ReactNode }) {
  return (
    <span className={styles.shield} aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 3 19 6v5c0 4.7-2.6 8-7 10-4.4-2-7-5.3-7-10V6l7-3Z" /><path d="m9 12 2 2 4-5" /></svg>
      {children}
    </span>
  );
}

function apiError(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object" || !("error" in value)) return fallback;
  const candidate = value.error;
  if (!candidate || typeof candidate !== "object" || !("message" in candidate)) return fallback;
  return typeof candidate.message === "string" ? candidate.message : fallback;
}

function isGuardianWorkspace(value: unknown): value is GuardianWorkspace {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GuardianWorkspace>;
  return Boolean(candidate.settings && candidate.student?.id && candidate.guardian?.id);
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false
}: {
  checked: boolean;
  onChange(value: boolean): void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className={styles.toggleRow}>
      <span><strong>{label}</strong><small>{description}</small></span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.toggle} aria-hidden="true"><i /></span>
    </label>
  );
}

function sourceDescription(source: GuardianSourceSummary): string {
  if (source.status === "active") {
    return source.lastSyncAt
      ? `Last read ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(source.lastSyncAt))}`
      : "Connected and ready to read";
  }
  if (source.status === "error") return "Connection needs guardian attention";
  if (source.status === "revoked") return "Access has been revoked";
  return "No connection yet";
}

function sourcePermissionKey(provider: GuardianSourceSummary["provider"]): SourcePermissionKey {
  if (provider === "google_classroom") return "googleClassroom";
  if (provider === "band_ical") return "bandCalendar";
  if (provider === "school_calendar") return "districtCalendar";
  return "schoolSupplies";
}

function sourceIcon(provider: GuardianSourceSummary["provider"]): string {
  if (provider === "google_classroom") return "G";
  if (provider === "band_ical") return "B";
  if (provider === "school_calendar") return "C";
  return "S";
}

export function GuardianSetupWorkspace() {
  const [status, setStatus] = useState<WorkspaceStatus>("locked");
  const [csrfToken, setCsrfToken] = useState("");
  const [workspace, setWorkspace] = useState<GuardianWorkspace | null>(null);
  const [message, setMessage] = useState("");
  const [bandUrl, setBandUrl] = useState("");
  const [schoolUrl, setSchoolUrl] = useState("");
  const [districtCalendarUrl, setDistrictCalendarUrl] = useState("");
  const [supplyUrl, setSupplyUrl] = useState("");
  const [activeSection, setActiveSection] = useState<GuardianSectionId>(guardianNavigationItems[0].id);
  const guardianWorkspaceId = workspace?.guardian.id ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const result = new URLSearchParams(window.location.search).get("source");
      if (!result) return;
      const savedCsrf = window.sessionStorage.getItem(guardianCsrfStorageKey);
      const resultMessage = googleResultMessage(result);
      if (!savedCsrf) {
        setMessage("Continue as Matt to reopen the guardian workspace and check the connection.");
        return;
      }
      setCsrfToken(savedCsrf);
      setStatus("loading");
      void readWorkspace(savedCsrf)
        .then(() => setMessage(resultMessage))
        .catch((caught: unknown) => {
          setStatus("error");
          setMessage(caught instanceof Error ? caught.message : "Unable to reload source status.");
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!guardianWorkspaceId) return;
    const sections = guardianNavigationItems
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => section instanceof HTMLElement);
    if (sections.length === 0) return;

    const syncHash = () => {
      const sectionId = guardianSectionFromHash(window.location.hash);
      setActiveSection(sectionId);
      if (!window.location.hash) return;
      window.requestAnimationFrame(() => {
        const target = document.getElementById(sectionId);
        target?.scrollIntoView({ block: "start" });
        target?.focus({ preventScroll: true });
      });
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);

    if (typeof IntersectionObserver === "undefined") {
      const onScroll = () => {
        const current = [...sections].reverse().find((section) => section.getBoundingClientRect().top <= 150);
        if (current) setActiveSection(current.id as GuardianSectionId);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => {
        window.removeEventListener("hashchange", syncHash);
        window.removeEventListener("scroll", onScroll);
      };
    }

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (visible?.target.id) setActiveSection(visible.target.id as GuardianSectionId);
    }, { rootMargin: "-120px 0px -58% 0px", threshold: [0, 0.1] });
    sections.forEach((section) => observer.observe(section));
    return () => {
      window.removeEventListener("hashchange", syncHash);
      observer.disconnect();
    };
  }, [guardianWorkspaceId]);

  function moveRailFocus(event: KeyboardEvent<HTMLElement>) {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href^='#']"));
    const currentIndex = links.indexOf(event.target);
    const nextIndex = nextGuardianNavigationIndex(currentIndex, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    links[nextIndex]?.focus();
  }

  async function readWorkspace(token: string) {
    const response = await fetch("/api/guardian/setup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-homeroom-csrf": token },
      body: JSON.stringify({ action: "read" })
    });
    const data: unknown = await response.json();
    if (!response.ok || !isGuardianWorkspace(data)) {
      throw new Error(apiError(data, "Unable to load guardian settings."));
    }
    setWorkspace(data);
    setStatus("ready");
  }

  async function beginGuardianSession() {
    setStatus("loading");
    setMessage("");
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureKey: "emily_band_camp_v1", role: "guardian" })
      });
      const data = await response.json() as { csrfToken?: unknown; error?: { message?: string } };
      if (!response.ok || typeof data.csrfToken !== "string") {
        throw new Error(apiError(data, "Unable to start the guardian workspace."));
      }
      setCsrfToken(data.csrfToken);
      window.sessionStorage.setItem(guardianCsrfStorageKey, data.csrfToken);
      await readWorkspace(data.csrfToken);
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to start the guardian workspace.");
    }
  }

  function updateSettings(change: (current: GuardianSetupSettings) => GuardianSetupSettings) {
    setWorkspace((current) => current
      ? { ...current, settings: change(current.settings) }
      : current
    );
    setMessage("");
  }

  function updateProfile(change: Partial<GuardianSetupSettings["profile"]>) {
    updateSettings((current) => ({
      ...current,
      profile: { ...current.profile, ...change }
    }));
  }

  function toggleModality(modality: Modality) {
    if (!workspace) return;
    const selected = workspace.settings.profile.learningModalities;
    const next = selected.includes(modality)
      ? selected.filter((value) => value !== modality)
      : [...selected, modality];
    updateProfile({ learningModalities: next });
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !csrfToken) return;
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/guardian/setup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({
          action: "save",
          expectedVersion: workspace.settingsVersion,
          settings: workspace.settings
        })
      });
      const data: unknown = await response.json();
      if (!response.ok || !isGuardianWorkspace(data)) {
        throw new Error(apiError(data, "Unable to save guardian settings."));
      }
      setWorkspace(data);
      setStatus("ready");
      setMessage("Emily’s support settings are saved and active.");
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to save guardian settings.");
    }
  }

  async function connectGoogle() {
    if (!csrfToken) return;
    setStatus("connecting");
    setMessage("");
    try {
      window.sessionStorage.setItem(guardianCsrfStorageKey, csrfToken);
      const response = await fetch("/api/integrations/google/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: "{}"
      });
      const data = await response.json() as { authorizationUrl?: unknown; error?: { message?: string } };
      if (!response.ok || typeof data.authorizationUrl !== "string") {
        throw new Error(apiError(data, "Unable to begin Google authorization."));
      }
      const destination = new URL(data.authorizationUrl);
      if (destination.origin !== "https://accounts.google.com") {
        throw new Error("The Google authorization destination was not recognized.");
      }
      window.location.assign(destination.toString());
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to begin Google authorization.");
    }
  }

  async function connectBand() {
    if (!csrfToken || !bandUrl.trim()) return;
    setStatus("connecting");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/band/connect", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({
          calendarUrl: bandUrl.trim(),
          displayName: calendarFeedDisplayName(bandUrl.trim())
        })
      });
      const data = await response.json() as { connected?: boolean; eventCount?: number; error?: { message?: string } };
      if (!response.ok || !data.connected) {
        throw new Error(apiError(data, "Unable to connect the band calendar feed."));
      }
      setBandUrl("");
      await readWorkspace(csrfToken);
      setMessage(`Band calendar connected with ${data.eventCount ?? 0} current events.`);
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to connect the band calendar feed.");
    }
  }

  async function syncSource(provider: GuardianSourceSummary["provider"]) {
    if (!csrfToken) return;
    setStatus("syncing");
    setMessage("");
    try {
      const official = provider === "school_calendar" || provider === "school_supplies";
      const response = await fetch(official ? "/api/integrations/school" : "/api/integrations/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify(official ? { action: "sync", provider } : { provider })
      });
      const data = await response.json() as { synced?: boolean; recordCount?: number; error?: { message?: string } };
      if (!response.ok || !data.synced) {
        throw new Error(apiError(data, "Unable to refresh this read-only source."));
      }
      await readWorkspace(csrfToken);
      setMessage(`Read-only source refreshed with ${data.recordCount ?? 0} current records.`);
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to refresh this read-only source.");
    }
  }

  async function connectSchoolCalendar() {
    if (!csrfToken || !schoolUrl.trim() || !districtCalendarUrl.trim()) return;
    setStatus("connecting");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/school", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({
          action: "connect_calendar",
          schoolUrl: schoolUrl.trim(),
          districtCalendarUrl: districtCalendarUrl.trim()
        })
      });
      const data = await response.json() as { connected?: boolean; eventCount?: number; error?: { message?: string } };
      if (!response.ok || !data.connected) throw new Error(apiError(data, "Unable to connect official school calendars."));
      await readWorkspace(csrfToken);
      setMessage(`Official school calendar connected with ${data.eventCount ?? 0} attributed events.`);
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to connect official school calendars.");
    }
  }

  async function connectSupplyList() {
    if (!csrfToken || !supplyUrl.trim()) return;
    setStatus("connecting");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/school", {
        method: "POST",
        headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
        body: JSON.stringify({ action: "connect_supplies", sourceUrl: supplyUrl.trim() })
      });
      const data = await response.json() as { connected?: boolean; itemCount?: number; error?: { message?: string } };
      if (!response.ok || !data.connected) throw new Error(apiError(data, "Unable to connect the official supply list."));
      await readWorkspace(csrfToken);
      setMessage(`Connected ${data.itemCount ?? 0} items from the official supply list.`);
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to connect the official supply list.");
    }
  }

  if (!workspace) {
    return (
      <main className={styles.entryShell}>
        <Link className={styles.entryBrand} href="/" aria-label="Homeroom student home">
          <span className={styles.brandMark}>✦</span> homeroom
        </Link>
        <section className={styles.entryCard} aria-labelledby="guardian-entry-title">
          <div className={styles.entryArtwork} aria-hidden="true">
            <span className={styles.parentOrb}>M</span>
            <span className={styles.linkLine} />
            <span className={styles.studentOrb}>E</span>
            <span className={styles.artBadge}><Shield /> Guardian controlled</span>
          </div>
          <p className={styles.eyebrow}>Guardian workspace</p>
          <h1 id="guardian-entry-title">Set the support.<br />Emily stays in control.</h1>
          <p className={styles.entryCopy}>
            Set learning support, safety, privacy, and school connections in the guardian workspace.
          </p>
          <button className={styles.primaryButton} type="button" onClick={beginGuardianSession} disabled={status === "loading"}>
            <Shield /> {status === "loading" ? "Opening workspace…" : "Continue as Matt"}
          </button>
          <p className={styles.boundaryNote}>Emily’s student experience cannot change these settings.</p>
          {message && <p className={styles.error} role="alert">{message}</p>}
        </section>
      </main>
    );
  }

  const settings = workspace.settings;
  const isBusy = status === "saving" || status === "connecting" || status === "syncing";

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/"><span className={styles.brandMark}>✦</span> homeroom</Link>
        <div className={styles.guardianBadge}><Shield /> Guardian workspace</div>
        <Link className={styles.identity} href="/" aria-label="Switch Homeroom profile"><span>M</span><div><strong>Matt</strong><small>Emily’s parent · switch</small></div></Link>
      </header>

      <div className={styles.layout}>
        <aside className={styles.rail}>
          <p className={styles.railLabel}>GUARDIAN</p>
          <nav className={styles.railNav} aria-label="Guardian workspace" onKeyDown={moveRailFocus}>
            {guardianNavigationItems.map((item) => (
              <a
                className={activeSection === item.id ? styles.activeNav : undefined}
                href={item.href}
                aria-current={activeSection === item.id ? "location" : undefined}
                key={item.id}
                onClick={() => setActiveSection(item.id)}
              >
                <b aria-hidden="true">{item.marker}</b>
                <span>{item.label}<small>{item.detail}</small></span>
              </a>
            ))}
          </nav>
          <div className={styles.railTrust}><Shield /><span><strong>Parent controlled</strong><small>Student settings are protected</small></span></div>
        </aside>

        <form className={styles.content} onSubmit={saveSettings}>
          <section className={styles.hero}>
            <div>
              <p className={styles.eyebrow}>Emily’s support plan</p>
              <h1>Support Emily.<br /><span>Keep her in control.</span></h1>
              <p>These settings shape how Homeroom plans and coaches.</p>
            </div>
            <div className={styles.readinessGraphic} aria-label="Four guardian setup areas are ready">
              <div className={styles.readinessRing}><strong>4</strong><span>AREAS</span></div>
              <p><strong>Settings ready</strong><small>Age-aware · visual · private</small></p>
            </div>
          </section>

          <GuardianInbox csrfToken={csrfToken} />
          <GuardianProgress progress={workspace.progress} />

          <section className={styles.card} id="household" aria-labelledby="student-profile-title" tabIndex={-1}>
            <span className={styles.anchorAlias} id="student-profile" aria-hidden="true" />
            <div className={styles.sectionHead}>
              <div><p className={styles.eyebrow}>Household & student</p><h2 id="student-profile-title">Your household</h2></div>
              <span className={styles.policyPill}>Support adjusts with age and grade</span>
            </div>
            <div className={styles.householdGrid} aria-label="Current Homeroom household">
              <article className={styles.memberCard}>
                <span className={styles.guardianAvatar}>M</span>
                <span><strong>{workspace.guardian.name}</strong><small>{workspace.guardian.relationship} · Guardian workspace</small></span>
                <span className={styles.rolePill}>Guardian</span>
                <p>Manages support settings, safety boundaries, privacy preferences, and source connections.</p>
              </article>
              <article className={styles.memberCard}>
                <span className={styles.emilyAvatar}>E</span>
                <span><strong>{workspace.student.name}</strong><small>Grade {workspace.student.grade} · Age {workspace.student.age}</small></span>
                <span className={styles.studentRolePill}>Student</span>
                <p>Controls her learning work and chooses what, if anything, is shared with Matt.</p>
              </article>
            </div>
            <p className={styles.futureNote}>This version supports one guardian and one student.</p>
            <div className={styles.profileDivider}><span>Emily’s learning profile</span></div>
            <div className={styles.profileGrid}>
              <div className={styles.emilyCard}>
                <div className={styles.emilyAvatar}>E</div>
                <div><strong>Emily</strong><small>Student profile</small></div>
                <span>Entering high school</span>
              </div>
              <label className={styles.field}><span>Age</span><input type="number" min="5" max="19" value={settings.profile.age} onChange={(event) => updateProfile({ age: Number(event.target.value) })} /></label>
              <label className={styles.field}><span>Grade</span><select value={settings.profile.grade} onChange={(event) => updateProfile({ grade: Number(event.target.value) })}>{Array.from({ length: 13 }, (_, grade) => <option key={grade} value={grade}>{grade === 0 ? "Kindergarten" : `Grade ${grade}`}</option>)}</select></label>
            </div>
            <fieldset className={styles.modalityFieldset}>
              <legend>Learning modes that help Emily</legend>
              <div className={styles.choiceChips}>{modalityOptions.map((option) => <label key={option.value} className={settings.profile.learningModalities.includes(option.value) ? styles.choiceActive : ""}><input type="checkbox" checked={settings.profile.learningModalities.includes(option.value)} onChange={() => toggleModality(option.value)} /><span>{option.label}</span></label>)}</div>
            </fieldset>
          </section>

          <section className={styles.card} id="learning-support" aria-labelledby="learning-support-title" tabIndex={-1}>
            <div className={styles.sectionHead}>
              <div><p className={styles.eyebrow}>2 · How Emily learns</p><h2 id="learning-support-title">Teach the skills behind the schoolwork</h2></div>
              <span className={styles.alwaysOn}>Always taught</span>
            </div>
            <div className={styles.skillMap}>{skills.map((skill, index) => <div className={styles.skillCard} key={skill.key}><div className={styles.skillTop}><span>{skill.glyph}</span><small>0{index + 1}</small></div><strong>{skill.label}</strong><p>{skill.verb}</p><select aria-label={`${skill.label} level`} value={settings.profile.executiveSkills[skill.key]} onChange={(event) => updateProfile({ executiveSkills: { ...settings.profile.executiveSkills, [skill.key]: event.target.value as GuardianSetupSettings["profile"]["executiveSkills"][ExecutiveSkillKey] } })}><option value="emerging">Emerging · more guidance</option><option value="developing">Developing · guided practice</option><option value="independent">Independent · check-ins</option></select></div>)}</div>

            <div className={styles.visualPanel}>
              <div className={styles.visualCopy}><p className={styles.eyebrow}>Visual learning support</p><h3>See the path, then take the next step.</h3><p>Sessions use roadmaps, timeboxes, task chunks, and visual examples.</p></div>
              <div className={styles.roadmap} aria-label="Example visual learning roadmap"><div><i>1</i><span>Plan<small>Choose time</small></span></div><div><i>2</i><span>Gather<small>Get ready</small></span></div><div><i>3</i><span>Focus<small>One chunk</small></span></div><div><i>4</i><span>Reflect<small>What worked?</small></span></div></div>
            </div>

            <div className={styles.settingsGrid}>
              <label className={styles.field}><span>Default timebox</span><select value={settings.learning.preferredSessionMinutes} onChange={(event) => updateSettings((current) => ({ ...current, learning: { ...current.learning, preferredSessionMinutes: Number(event.target.value) as 10 | 15 | 20 } }))}><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="20">20 minutes</option></select></label>
              <label className={styles.field}><span>How sessions begin</span><select value={settings.learning.sessionStart} onChange={(event) => updateSettings((current) => ({ ...current, learning: { ...current.learning, sessionStart: event.target.value as GuardianSetupSettings["learning"]["sessionStart"] } }))}><option value="example_first">Example first</option><option value="questions_first">Questions first</option><option value="mix_it_up">Mix it up</option></select></label>
              <label className={styles.field}><span>Encouragement style</span><select value={settings.learning.encouragementStyle} onChange={(event) => updateSettings((current) => ({ ...current, learning: { ...current.learning, encouragementStyle: event.target.value as GuardianSetupSettings["learning"]["encouragementStyle"] } }))}><option value="calm">Calm and steady</option><option value="direct">Direct and clear</option><option value="celebratory">Celebratory</option></select></label>
              <label className={styles.field}><span>Visual detail</span><select value={settings.learning.visualDensity} onChange={(event) => updateSettings((current) => ({ ...current, learning: { ...current.learning, visualDensity: event.target.value as GuardianSetupSettings["learning"]["visualDensity"] } }))}><option value="standard">Standard</option><option value="rich">Rich visual support</option></select></label>
            </div>

            <div className={styles.routineGrid}>
              <Toggle checked={settings.routines.dailyPlanning} onChange={(value) => updateSettings((current) => ({ ...current, routines: { ...current.routines, dailyPlanning: value } }))} label="Daily planning ritual" description="Choose what fits before work begins." />
              <Toggle checked={settings.routines.assignmentChecklist} onChange={(value) => updateSettings((current) => ({ ...current, routines: { ...current.routines, assignmentChecklist: value } }))} label="Assignment setup checklist" description="Goal, materials, chunks, then start." />
              <Toggle checked={settings.routines.explainPriorityReason} onChange={(value) => updateSettings((current) => ({ ...current, routines: { ...current.routines, explainPriorityReason: value } }))} label="Explain why this comes first" description="Make priority reasoning visible." />
              <Toggle checked={settings.routines.estimateThenReflect} onChange={(value) => updateSettings((current) => ({ ...current, routines: { ...current.routines, estimateThenReflect: value } }))} label="Estimate, then reflect" description="Build time awareness without pressure." />
            </div>
          </section>

          <section className={styles.card} id="safety-privacy" aria-labelledby="safety-title" tabIndex={-1}>
            <div className={styles.sectionHead}><div><p className={styles.eyebrow}>3 · Safety & privacy</p><h2 id="safety-title">Clear boundaries, visible to you</h2></div><Shield /></div>
            <div className={styles.twoColumns}>
              <div><h3>Safety</h3><Toggle checked={settings.safety.ageAppropriateMode} onChange={() => undefined} disabled label="Age-appropriate mode" description="Always on; explanations follow Emily’s age and grade." /><Toggle checked={settings.safety.proactiveReminders} onChange={(value) => updateSettings((current) => ({ ...current, safety: { ...current.safety, proactiveReminders: value } }))} label="Proactive reminders" description="Offer calm reminders before due dates." /><label className={styles.field}><span>External links</span><select value={settings.safety.externalLinks} onChange={(event) => updateSettings((current) => ({ ...current, safety: { ...current.safety, externalLinks: event.target.value as GuardianSetupSettings["safety"]["externalLinks"] } }))}><option value="guardian_approval">Require guardian approval</option><option value="blocked">Block external links</option></select></label><div className={styles.timeFields}><label className={styles.field}><span>Quiet hours begin</span><input type="time" value={settings.safety.quietHours.start} onChange={(event) => updateSettings((current) => ({ ...current, safety: { ...current.safety, quietHours: { ...current.safety.quietHours, start: event.target.value } } }))} /></label><label className={styles.field}><span>Quiet hours end</span><input type="time" value={settings.safety.quietHours.end} onChange={(event) => updateSettings((current) => ({ ...current, safety: { ...current.safety, quietHours: { ...current.safety.quietHours, end: event.target.value } } }))} /></label></div></div>
              <div><h3>Privacy</h3><Toggle checked={settings.privacy.rememberLearningPreferences} onChange={(value) => updateSettings((current) => ({ ...current, privacy: { ...current.privacy, rememberLearningPreferences: value } }))} label="Remember learning preferences" description="Retain useful learning-style signals across sessions." /><Toggle checked={settings.privacy.shareProgressSummaries} onChange={(value) => updateSettings((current) => ({ ...current, privacy: { ...current.privacy, shareProgressSummaries: value } }))} label="Share progress summaries" description="See growth and next steps—not every interaction." /><Toggle checked={false} onChange={() => undefined} disabled label="Share private coaching" description="Always off. Answers, drafts, and private coaching stay with Emily." /><div className={styles.privacyBoundary}><Shield /><span><strong>Summary, not surveillance</strong><small>Guardian views exclude answers, step-by-step work, attempts, hints, and private coaching.</small></span></div></div>
            </div>
          </section>

          <section className={styles.card} id="school-sources" aria-labelledby="sources-title" tabIndex={-1}>
            <div className={styles.sectionHead}><div><p className={styles.eyebrow}>Sources</p><h2 id="sources-title">School and activity connections</h2></div><span className={styles.readOnlyPill}>Read only</span></div>
            <p className={styles.sectionIntro}>Connect the services your school and activities use. Homeroom reads information but cannot make changes.</p>
            <div className={styles.sourceTypeGrid} aria-label="Source types supported by Homeroom">
              {supportedGuardianSourceTypes.map((sourceType) => (
                <article key={sourceType.provider}>
                  <span>{sourceType.typeLabel}</span>
                  <strong>{sourceType.connectorLabel}</strong>
                  <p>{sourceType.capability}</p>
                  <small>{sourceType.limitation}</small>
                </article>
              ))}
            </div>
            <div className={styles.sourceListHeading}>
              <span><strong>This household’s connections</strong><small>Emily and Matt’s current providers and setup state</small></span>
              <span className={styles.householdExamplePill}>Current household</span>
            </div>
            <div className={styles.sourcesGrid}>{workspace.sources.map((source) => {
              const permissionKey = sourcePermissionKey(source.provider);
              const permission = settings.sourcePermissions[permissionKey];
              const presentation = sourceTypePresentation(source.provider);
              return (
                <article className={styles.sourceCard} key={source.provider}>
                  <div className={styles.sourceIcon}>{sourceIcon(source.provider)}</div>
                  <div className={styles.sourceTitle}>
                    <span><small className={styles.sourceKind}>{presentation.typeLabel}</small><strong>{source.label}</strong><small>{sourceDescription(source)}</small></span>
                    <span className={`${styles.statusDot} ${source.status === "active" ? styles.statusActive : ""}`}>
                      {source.status === "active" ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <Toggle
                    checked={permission.enabled}
                    onChange={(value) => updateSettings((current) => ({
                      ...current,
                      sourcePermissions: {
                        ...current.sourcePermissions,
                        [permissionKey]: { ...current.sourcePermissions[permissionKey], enabled: value }
                      }
                    }))}
                    label="Allow this source"
                    description="You control this connection."
                  />
                  {source.provider === "google_classroom" && (source.status === "active"
                    ? <button className={styles.sourceAction} type="button" disabled={isBusy} onClick={() => void syncSource(source.provider)}>Refresh Classroom</button>
                    : <button className={styles.sourceAction} type="button" disabled={isBusy || !permission.enabled} onClick={() => void connectGoogle()}>{status === "connecting" ? "Opening Google…" : "Connect Google Classroom"}</button>)}
                  {source.provider === "band_ical" && (source.status === "active"
                    ? <button className={styles.sourceAction} type="button" disabled={isBusy} onClick={() => void syncSource(source.provider)}>Refresh band calendar</button>
                    : <div className={styles.bandConnect}><label htmlFor="guardian-band-url">Private HTTPS iCalendar URL</label><div><input id="guardian-band-url" type="url" inputMode="url" autoComplete="off" maxLength={2_048} placeholder="BAND, CutTime, or compatible calendar feed" value={bandUrl} onChange={(event) => setBandUrl(event.target.value)} /><button className={styles.sourceAction} type="button" disabled={isBusy || !permission.enabled || !bandUrl.trim()} onClick={() => void connectBand()}>Connect calendar</button></div><small>Use a private calendar feed from BAND, CutTime, or another supported service.</small></div>)}
                  {source.provider === "school_calendar" && (source.status === "active"
                    ? <button className={styles.sourceAction} type="button" disabled={isBusy} onClick={() => void syncSource(source.provider)}>Refresh district + school events</button>
                    : <div className={styles.bandConnect}>
                        <label htmlFor="guardian-school-url">Official school events page</label>
                        <input id="guardian-school-url" type="url" maxLength={2_048} placeholder="https://your-school.example/events" value={schoolUrl} onChange={(event) => setSchoolUrl(event.target.value)} />
                        <label htmlFor="guardian-district-calendar-url">Official district calendar page</label>
                        <input id="guardian-district-calendar-url" type="url" maxLength={2_048} placeholder="https://your-district.example/calendar" value={districtCalendarUrl} onChange={(event) => setDistrictCalendarUrl(event.target.value)} />
                        <button className={styles.sourceAction} type="button" disabled={isBusy || !permission.enabled || !schoolUrl.trim() || !districtCalendarUrl.trim()} onClick={() => void connectSchoolCalendar()}>Connect official calendars</button>
                        <small>Supported now: official Comal ISD school and district pages.</small>
                      </div>)}
                  {source.provider === "school_supplies" && <div className={styles.bandConnect}>
                    <label htmlFor="guardian-supply-url">Official school or course supply-list page</label>
                    <input id="guardian-supply-url" type="url" maxLength={2_048} placeholder="https://your-school.example/supply-list" value={supplyUrl} onChange={(event) => setSupplyUrl(event.target.value)} />
                    <div>
                      <button className={styles.sourceAction} type="button" disabled={isBusy || !permission.enabled || !supplyUrl.trim()} onClick={() => void connectSupplyList()}>{source.status === "active" ? "Add another official list" : "Connect supply list"}</button>
                      {source.status === "active" && <button className={styles.sourceAction} type="button" disabled={isBusy} onClick={() => void syncSource(source.provider)}>Refresh all lists</button>}
                    </div>
                    <small>Homeroom shows only items found on the official page.</small>
                  </div>}
                </article>
              );
            })}</div>

            <div className={styles.bandSourceMap}>
              <div className={styles.bandSourceMapHeading}>
                <p className={styles.eyebrow}>Connected resources</p>
                <h3>School and activity tools</h3>
                <p>Review the resources connected for this household.</p>
              </div>
              <div className={styles.bandResourceGrid}>
                {bandProgramSources.map((source) => (
                  <article key={source.id}>
                    <div><strong>{source.label}</strong><span>{source.access.replace("_", " ")}</span></div>
                    <p>{source.purpose}</p>
                    <small>{source.guardianNote}</small>
                    <a href={source.url} target="_blank" rel="noreferrer">{source.connection === "reviewed_oauth_required" ? "Review API path" : source.connection === "shared_folder" ? "Open shared folder" : source.connection === "verified_link" ? "Open official portal" : "Official setup guide"} ↗</a>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <footer className={styles.saveBar}>
            <div><Shield /><span><strong>These settings apply across Homeroom</strong><small>Version {workspace.settingsVersion}{workspace.updatedAt ? ` · Last saved ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(workspace.updatedAt))}` : " · Ready for first save"}</small></span></div>
            {message && <p className={status === "error" ? styles.error : styles.success} role="status">{message}</p>}
            <button className={styles.primaryButton} type="submit" disabled={isBusy}>{isBusy ? "Saving…" : "Save guardian settings"}</button>
          </footer>
        </form>
      </div>
    </main>
  );
}
