import { describe, expect, it } from "vitest";
import { BandFixtureAdapter, DemoSchoolAdapter, SourceVersionError } from "../lib/source/adapters";

describe("fixture source adapters", () => {
  it("returns seven normalized courses for Emily", async () => {
    const adapter = new DemoSchoolAdapter();
    const result = await adapter.listCourses("student_emily");
    expect(result.data).toHaveLength(7);
    expect(result.source).toBe("demo_school");
    await expect(adapter.listReadinessActivities("student_emily")).resolves.toMatchObject({
      data: [{ id: "linear_equation_01", optional: true }]
    });
    await expect(adapter.listCourses("unknown_student")).rejects.toThrow("Unknown fictional student");
  });

  it("reads the allowlisted BAND event, material, and guardian action", async () => {
    const adapter = new BandFixtureAdapter();
    await expect(adapter.listUpcomingEvents("student_emily")).resolves.toMatchObject({
      sourceVersion: 1,
      data: [{ checkIn: "07:30" }]
    });
    await expect(adapter.getEventDetails("event_band_camp_day_1")).resolves.toMatchObject({
      data: { checkIn: "07:30" }
    });
    await expect(adapter.readMaterial("material_band_camp_packing")).resolves.toMatchObject({
      data: { required: expect.arrayContaining(["instrument", "water"]) }
    });
    await expect(adapter.getGuardianAction("guardian_action_physical_form")).resolves.toMatchObject({
      data: { actorId: "guardian_matt" }
    });

    await adapter.sync(1, 2);
    await expect(adapter.listUpcomingEvents("student_emily")).resolves.toMatchObject({
      sourceVersion: 2,
      data: [{ checkIn: "07:15" }]
    });
  });

  it("rejects records outside the fictional source allowlist", async () => {
    const adapter = new BandFixtureAdapter();
    await expect(adapter.listUpcomingEvents("another_student")).rejects.toThrow();
    await expect(adapter.getEventDetails("another_event")).rejects.toThrow();
    await expect(adapter.readMaterial("another_material")).rejects.toThrow();
    await expect(adapter.getGuardianAction("another_action")).rejects.toThrow();
  });

  it("appends the controlled band source change once", async () => {
    const adapter = new BandFixtureAdapter();
    const first = await adapter.sync(1, 2);
    const repeated = await adapter.sync(1, 2);
    expect(first.data.diff).toEqual([{ field: "checkIn", before: "07:30", after: "07:15" }]);
    expect(repeated.data.idempotent).toBe(true);
    expect(adapter.currentVersion).toBe(2);
  });

  it("rejects an unsupported source version", async () => {
    const adapter = new BandFixtureAdapter();
    await expect(adapter.sync(2, 3)).rejects.toBeInstanceOf(SourceVersionError);
    expect(adapter.currentVersion).toBe(1);
  });
});
