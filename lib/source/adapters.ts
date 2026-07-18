import {
  bandCampV1,
  bandCampV2,
  courseFixtures,
  diffBandSource,
  guardianAction,
  packingMaterial
} from "../domain/fixtures";

export interface SourceResult<T> {
  ok: true;
  source: string;
  sourceVersion: number;
  data: T;
  evidenceIds: string[];
}

export class SourceVersionError extends Error {
  readonly code = "SOURCE_VERSION_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "SourceVersionError";
  }
}

function assertEmily(studentId: string) {
  if (studentId !== "student_emily") throw new Error("Unknown fictional student.");
}

export class DemoSchoolAdapter {
  async listCourses(studentId: string): Promise<SourceResult<typeof courseFixtures>> {
    assertEmily(studentId);
    return {
      ok: true,
      source: "demo_school",
      sourceVersion: 1,
      data: courseFixtures,
      evidenceIds: courseFixtures.map((course) => course.id)
    };
  }

  async listReadinessActivities(studentId: string) {
    assertEmily(studentId);
    return {
      ok: true as const,
      source: "demo_school",
      sourceVersion: 1,
      data: [{ id: "linear_equation_01", courseId: "course_algebra_1", optional: true }],
      evidenceIds: ["linear_equation_01"]
    };
  }
}

export class BandFixtureAdapter {
  currentVersion: 1 | 2 = 1;

  async listUpcomingEvents(studentId: string) {
    assertEmily(studentId);
    const event = this.currentVersion === 1 ? bandCampV1 : bandCampV2;
    return { ok: true as const, source: "band_fixture", sourceVersion: this.currentVersion, data: [event], evidenceIds: [event.id] };
  }

  async getEventDetails(eventId: string) {
    if (eventId !== bandCampV1.id) throw new Error("Unknown fictional event.");
    const event = this.currentVersion === 1 ? bandCampV1 : bandCampV2;
    return { ok: true as const, source: "band_fixture", sourceVersion: this.currentVersion, data: event, evidenceIds: [event.id] };
  }

  async readMaterial(materialId: string) {
    if (materialId !== packingMaterial.id) throw new Error("Unknown fictional material.");
    return { ok: true as const, source: "band_fixture", sourceVersion: this.currentVersion, data: packingMaterial, evidenceIds: [materialId] };
  }

  async getGuardianAction(actionId: string) {
    if (actionId !== guardianAction.id) throw new Error("Unknown fictional guardian action.");
    return { ok: true as const, source: "band_fixture", sourceVersion: this.currentVersion, data: guardianAction, evidenceIds: [actionId] };
  }

  async sync(expectedVersion: number, targetVersion: number) {
    if (this.currentVersion === 2 && expectedVersion === 1 && targetVersion === 2) {
      return {
        ok: true as const,
        source: "band_fixture",
        sourceVersion: 2,
        data: { diff: diffBandSource(bandCampV1, bandCampV2), idempotent: true },
        evidenceIds: [bandCampV2.id]
      };
    }
    if (this.currentVersion !== expectedVersion || expectedVersion !== 1 || targetVersion !== 2) {
      throw new SourceVersionError("Unsupported or stale source transition.");
    }
    this.currentVersion = 2;
    return {
      ok: true as const,
      source: "band_fixture",
      sourceVersion: 2,
      data: { diff: diffBandSource(bandCampV1, bandCampV2), idempotent: false },
      evidenceIds: [bandCampV2.id]
    };
  }
}
