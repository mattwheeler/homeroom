import { describe, expect, it } from "vitest";

import {
  buildGuardianWorkspace,
  defaultGuardianSetupSettings,
  guardianSetupSettingsSchema
} from "../lib/domain/guardian-setup-profile";

describe("guardian-owned student setup", () => {
  it("preloads Emily with age-aware executive-skill and visual-learning support", () => {
    const settings = defaultGuardianSetupSettings();
    const workspace = buildGuardianWorkspace({ settings, settingsVersion: 0, updatedAt: null }, []);

    expect(settings.profile).toMatchObject({
      studentId: "student_emily",
      name: "Emily",
      age: 14,
      grade: 9,
      executiveSkills: {
        timeManagement: "developing",
        organization: "developing",
        prioritization: "developing"
      }
    });
    expect(workspace.policy).toMatchObject({
      developmentalStage: "early_high_school",
      visualFirst: true,
      maxDirectionsAtOnce: 3
    });
    expect(workspace.policy.requiredExecutiveRoutines.map((routine) => routine.skill)).toEqual([
      "time_management",
      "organization",
      "prioritization"
    ]);
    expect(workspace.policy.requiredVisualScaffolds).toEqual(expect.arrayContaining([
      "session_roadmap",
      "visible_timebox",
      "task_chunks",
      "priority_cue",
      "worked_example_or_organizer"
    ]));
  });

  it("keeps source access guardian-owned and read-only", () => {
    const settings = defaultGuardianSetupSettings();

    expect(settings.sourcePermissions).toEqual({
      managedBy: "guardian",
      googleClassroom: { enabled: true, access: "read_only" },
      bandCalendar: { enabled: true, access: "read_only" },
      districtCalendar: { enabled: true, access: "read_only" },
      schoolSupplies: { enabled: true, access: "read_only" }
    });
    expect(() => guardianSetupSettingsSchema.parse({
      ...settings,
      sourcePermissions: {
        managedBy: "student",
        googleClassroom: { enabled: true, access: "write" },
        bandCalendar: { enabled: true, access: "read_only" }
      }
    })).toThrow();
  });

  it("rejects implausible age/grade combinations, private-work sharing, and extra input", () => {
    const settings = defaultGuardianSetupSettings();

    expect(() => guardianSetupSettingsSchema.parse({
      ...settings,
      profile: { ...settings.profile, age: 8, grade: 9 }
    })).toThrow();
    expect(() => guardianSetupSettingsSchema.parse({
      ...settings,
      privacy: { ...settings.privacy, sharePrivateCoaching: true }
    })).toThrow();
    expect(() => guardianSetupSettingsSchema.parse({ ...settings, administrator: true })).toThrow();
  });

  it("returns source status metadata without credentials", () => {
    const workspace = buildGuardianWorkspace(
      { settings: defaultGuardianSetupSettings(), settingsVersion: 2, updatedAt: "2026-07-18T22:00:00.000Z" },
      [{
        provider: "google_classroom",
        status: "active",
        displayName: "Google Classroom",
        lastSyncAt: "2026-07-18T21:59:00.000Z"
      }]
    );

    expect(workspace.settingsVersion).toBe(2);
    expect(workspace.sources).toEqual([
      expect.objectContaining({ provider: "google_classroom", status: "active" }),
      expect.objectContaining({ provider: "band_ical", status: "not_connected" }),
      expect.objectContaining({ provider: "school_calendar", status: "not_connected" }),
      expect.objectContaining({ provider: "school_supplies", status: "not_connected" })
    ]);
    expect(JSON.stringify(workspace)).not.toMatch(/token|secret|credential/i);
  });
});
