import { z } from "zod";

import {
  buildStudentSupportPolicy,
  emilyStudentSupportProfile,
  studentSupportProfileSchema,
  type StudentSupportPolicy
} from "./student-support-profile";
import {
  emptyGuardianProgress,
  type GuardianProgressProjection
} from "./guardian-progress";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const sourcePermissionSchema = z.object({
  enabled: z.boolean(),
  access: z.literal("read_only")
}).strict();

export const guardianSetupSettingsSchema = z.object({
  profile: studentSupportProfileSchema,
  learning: z.object({
    preferredSessionMinutes: z.union([z.literal(10), z.literal(15), z.literal(20)]),
    sessionStart: z.enum(["example_first", "questions_first", "mix_it_up"]),
    encouragementStyle: z.enum(["calm", "direct", "celebratory"]),
    visualDensity: z.enum(["standard", "rich"]),
    reduceMotion: z.boolean()
  }).strict(),
  routines: z.object({
    dailyPlanning: z.boolean(),
    assignmentChecklist: z.boolean(),
    explainPriorityReason: z.boolean(),
    estimateThenReflect: z.boolean()
  }).strict(),
  safety: z.object({
    ageAppropriateMode: z.literal(true),
    externalLinks: z.enum(["guardian_approval", "blocked"]),
    quietHours: z.object({ start: timeSchema, end: timeSchema }).strict(),
    proactiveReminders: z.boolean(),
    guardianEscalation: z.enum(["safety_only", "safety_and_overwhelm"])
  }).strict(),
  privacy: z.object({
    rememberLearningPreferences: z.boolean(),
    shareProgressSummaries: z.boolean(),
    sharePrivateCoaching: z.literal(false)
  }).strict(),
  sourcePermissions: z.object({
    managedBy: z.literal("guardian"),
    googleClassroom: sourcePermissionSchema,
    bandCalendar: sourcePermissionSchema,
    districtCalendar: sourcePermissionSchema.default({ enabled: true, access: "read_only" }),
    schoolSupplies: sourcePermissionSchema.default({ enabled: true, access: "read_only" })
  }).strict()
}).strict().superRefine((settings, context) => {
  if (settings.profile.grade <= 5 && settings.learning.preferredSessionMinutes > 15) {
    context.addIssue({
      code: "custom",
      path: ["learning", "preferredSessionMinutes"],
      message: "Elementary sessions must use a 10- or 15-minute timebox."
    });
  }
});

export type GuardianSetupSettings = z.infer<typeof guardianSetupSettingsSchema>;

export interface StoredGuardianSetup {
  settings: GuardianSetupSettings;
  settingsVersion: number;
  updatedAt: string | null;
}

export const guardianSourceStatusSchema = z.object({
  provider: z.enum(["google_classroom", "band_ical", "school_calendar", "school_supplies"]),
  status: z.enum(["active", "error", "revoked"]),
  displayName: z.string().min(1).max(80),
  lastSyncAt: z.string().datetime().nullable()
}).strict();

export type GuardianSourceStatus = z.infer<typeof guardianSourceStatusSchema>;

export interface GuardianSourceSummary {
  provider: "google_classroom" | "band_ical" | "school_calendar" | "school_supplies";
  label: string;
  status: GuardianSourceStatus["status"] | "not_connected";
  access: "read_only";
  managedBy: "guardian";
  lastSyncAt: string | null;
}

export interface GuardianWorkspace {
  guardian: { id: string; name: string; relationship: "Parent" };
  student: { id: string; name: string; age: number; grade: number };
  settingsVersion: number;
  updatedAt: string | null;
  settings: GuardianSetupSettings;
  policy: StudentSupportPolicy;
  sources: GuardianSourceSummary[];
  progress: GuardianProgressProjection;
}

export function defaultGuardianSetupSettings(): GuardianSetupSettings {
  return guardianSetupSettingsSchema.parse({
    profile: emilyStudentSupportProfile,
    learning: {
      preferredSessionMinutes: 15,
      sessionStart: "example_first",
      encouragementStyle: "calm",
      visualDensity: "rich",
      reduceMotion: false
    },
    routines: {
      dailyPlanning: true,
      assignmentChecklist: true,
      explainPriorityReason: true,
      estimateThenReflect: true
    },
    safety: {
      ageAppropriateMode: true,
      externalLinks: "guardian_approval",
      quietHours: { start: "21:30", end: "06:30" },
      proactiveReminders: true,
      guardianEscalation: "safety_and_overwhelm"
    },
    privacy: {
      rememberLearningPreferences: true,
      shareProgressSummaries: true,
      sharePrivateCoaching: false
    },
    sourcePermissions: {
      managedBy: "guardian",
      googleClassroom: { enabled: true, access: "read_only" },
      bandCalendar: { enabled: true, access: "read_only" },
      districtCalendar: { enabled: true, access: "read_only" },
      schoolSupplies: { enabled: true, access: "read_only" }
    }
  });
}

function sourceSummary(
  provider: GuardianSourceSummary["provider"],
  label: string,
  status: GuardianSourceStatus | undefined
): GuardianSourceSummary {
  return {
    provider,
    label: status?.displayName ?? label,
    status: status?.status ?? "not_connected",
    access: "read_only",
    managedBy: "guardian",
    lastSyncAt: status?.lastSyncAt ?? null
  };
}

export function buildGuardianWorkspace(
  stored: StoredGuardianSetup,
  sourceStatuses: GuardianSourceStatus[],
  identities: { guardianId?: string; studentId?: string; guardianName?: string } = {},
  progress?: GuardianProgressProjection
): GuardianWorkspace {
  const settings = guardianSetupSettingsSchema.parse(stored.settings);
  const statuses = sourceStatuses.map((status) => guardianSourceStatusSchema.parse(status));
  return {
    guardian: { id: identities.guardianId ?? "guardian_matt", name: identities.guardianName ?? "Matt", relationship: "Parent" },
    student: {
      id: identities.studentId ?? "student_emily",
      name: settings.profile.name,
      age: settings.profile.age,
      grade: settings.profile.grade
    },
    settingsVersion: stored.settingsVersion,
    updatedAt: stored.updatedAt,
    settings,
    policy: buildStudentSupportPolicy(settings.profile),
    sources: [
      sourceSummary(
        "google_classroom",
        "Google Classroom",
        statuses.find((source) => source.provider === "google_classroom")
      ),
      sourceSummary(
        "band_ical",
        "Private calendar feed",
        statuses.find((source) => source.provider === "band_ical")
      ),
      sourceSummary(
        "school_calendar",
        "Official school or district calendar",
        statuses.find((source) => source.provider === "school_calendar")
      ),
      sourceSummary(
        "school_supplies",
        "Official school or course supply list",
        statuses.find((source) => source.provider === "school_supplies")
      )
    ],
    progress: progress ?? emptyGuardianProgress({
      id: identities.studentId ?? "student_emily",
      name: settings.profile.name
    })
  };
}
