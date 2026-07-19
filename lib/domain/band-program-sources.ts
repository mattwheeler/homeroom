export type BandProgramSource = Readonly<{
  id: "cuttime_calendar" | "weekly_sheet" | "band_announcements" | "parent_portal";
  label: string;
  purpose: string;
  connection: "live_ical" | "shared_folder" | "reviewed_oauth_required" | "verified_link";
  access: "read_only";
  url: string;
  guardianNote: string;
}>;

export const bandProgramSources: readonly BandProgramSource[] = Object.freeze([
  {
    id: "cuttime_calendar",
    label: "CutTime calendar",
    purpose: "Rehearsals, performances, competitions, call times, and event changes.",
    connection: "live_ical",
    access: "read_only",
    url: "https://support.gocuttime.com/article/298-subscribing-to-individual-calendar",
    guardianNote: "Paste the private guardian calendar feed below. Homeroom reads it and never writes to CutTime."
  },
  {
    id: "weekly_sheet",
    label: "Weekly Sheet",
    purpose: "The Sunday plan: rehearsals, what to wear, meals, locations, reminders, and changes.",
    connection: "shared_folder",
    access: "read_only",
    url: "https://drive.google.com/drive/folders/11N94TRNItiOKE5UmV4W7KiEhEsw1VTqM",
    guardianNote: "Shared folder verified. No current-season sheet was visible during setup, so Homeroom will wait instead of inventing one."
  },
  {
    id: "band_announcements",
    label: "BAND announcements",
    purpose: "Last-minute director updates, reminders, announcements, and section communication.",
    connection: "reviewed_oauth_required",
    access: "read_only",
    url: "https://developers.band.us/develop/guide/api",
    guardianNote: "BAND requires a reviewed developer application before Homeroom can read posts. Calendar export remains supported now."
  },
  {
    id: "parent_portal",
    label: "Band of Warriors parent portal",
    purpose: "The verified hub for official family setup links and band resources.",
    connection: "verified_link",
    access: "read_only",
    url: "https://www.pieperbandofwarriors.com/parent-portal",
    guardianNote: "Opens the official parent resource hub; no credentials are collected by Homeroom."
  }
]);

export function calendarFeedDisplayName(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname === "gocuttime.com" || hostname.endsWith(".gocuttime.com")
    ? "Band of Warriors · CutTime calendar"
    : "BAND app calendar";
}
