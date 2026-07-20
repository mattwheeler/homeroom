import type { GuardianSourceSummary } from "../../lib/domain/guardian-setup-profile";

export const guardianNavigationItems = [
  { id: "guardian-inbox", href: "#guardian-inbox", label: "Inbox", detail: "Student-approved notes", marker: "I" },
  { id: "student-progress", href: "#student-progress", label: "Progress", detail: "Tasks and focus sessions", marker: "P" },
  { id: "household", href: "#household", label: "Household & student", detail: "People, age, and grade", marker: "H" },
  { id: "learning-support", href: "#learning-support", label: "Learning", detail: "Skills and visual support", marker: "L" },
  { id: "safety-privacy", href: "#safety-privacy", label: "Safety", detail: "Boundaries and privacy", marker: "S" },
  { id: "school-sources", href: "#school-sources", label: "Sources", detail: "Guardian-managed access", marker: "C" }
] as const;

export type GuardianSectionId = typeof guardianNavigationItems[number]["id"];

const guardianSectionIds = new Set<GuardianSectionId>(guardianNavigationItems.map((item) => item.id));

export function guardianSectionFromHash(hash: string): GuardianSectionId {
  const candidate = hash.replace(/^#/, "");
  if (candidate === "student-profile") return "household";
  return guardianSectionIds.has(candidate as GuardianSectionId)
    ? candidate as GuardianSectionId
    : guardianNavigationItems[0].id;
}

export function nextGuardianNavigationIndex(currentIndex: number, key: string): number | null {
  const length = guardianNavigationItems.length;
  if (key === "ArrowDown" || key === "ArrowRight") return (currentIndex + 1) % length;
  if (key === "ArrowUp" || key === "ArrowLeft") return (currentIndex - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}

interface GuardianSourceTypePresentation {
  typeLabel: string;
  connectorLabel: string;
  capability: string;
  limitation: string;
}

const sourceTypePresentations: Record<GuardianSourceSummary["provider"], GuardianSourceTypePresentation> = {
  google_classroom: {
    typeLabel: "Learning platform",
    connectorLabel: "Google Classroom",
    capability: "Reads active classes, published coursework, due dates, and the student’s submission state.",
    limitation: "Google Classroom is the learning-platform connector available in this build."
  },
  band_ical: {
    typeLabel: "Calendar feed",
    connectorLabel: "Private iCalendar link",
    capability: "Reads dated events from a compatible private calendar export.",
    limitation: "Works with supported BAND, CutTime, and other compatible HTTPS iCalendar feeds."
  },
  school_calendar: {
    typeLabel: "Official district or school page",
    connectorLabel: "Verified official calendar pages",
    capability: "Reads attributed dates and events from an official school or district publisher.",
    limitation: "The verified official-page connector in this build supports Comal ISD pages."
  },
  school_supplies: {
    typeLabel: "Official supply list",
    connectorLabel: "Verified school or course page",
    capability: "Reads only the supply lines published on an official page.",
    limitation: "The verified official-page connector in this build supports Comal ISD pages."
  }
};

export function sourceTypePresentation(provider: GuardianSourceSummary["provider"]): GuardianSourceTypePresentation {
  return sourceTypePresentations[provider];
}

export const supportedGuardianSourceTypes = (Object.keys(sourceTypePresentations) as Array<GuardianSourceSummary["provider"]>)
  .map((provider) => ({ provider, ...sourceTypePresentations[provider] }));
