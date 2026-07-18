export const HOMEROOM_SEED_KEY = "emily_band_camp_v1";

export const emilyFixture = Object.freeze({
  id: "student_emily",
  name: "Emily",
  age: 14,
  grade: 9,
  timeZone: "America/Chicago",
  quietHours: { start: "21:30", end: "06:30" }
});

export const mattFixture = Object.freeze({
  id: "guardian_matt",
  name: "Matt",
  relationship: "Parent"
});

export const courseFixtures = Object.freeze([
  { id: "course_english_1", name: "English I" },
  { id: "course_algebra_1", name: "Algebra I" },
  { id: "course_biology", name: "Biology" },
  { id: "course_world_geography", name: "World Geography" },
  { id: "course_band", name: "Concert and Marching Band" },
  { id: "course_art_1", name: "Art I" },
  { id: "course_spanish_1", name: "Spanish I" }
] as const);

export interface BandCampSource {
  id: string;
  sourceVersion: 1 | 2;
  date: string;
  start: string;
  checkIn: string;
  end: string;
  travelMinutes: number;
  arrivalBufferMinutes: number;
  departure: string;
  wake: string;
}

export const bandCampV1: Readonly<BandCampSource> = Object.freeze({
  id: "event_band_camp_day_1",
  sourceVersion: 1,
  date: "2026-08-03",
  start: "08:00",
  checkIn: "07:30",
  end: "16:00",
  travelMinutes: 20,
  arrivalBufferMinutes: 10,
  departure: "07:00",
  wake: "06:30"
});

export const bandCampV2: Readonly<BandCampSource> = Object.freeze({
  ...bandCampV1,
  sourceVersion: 2,
  checkIn: "07:15",
  departure: "06:45",
  wake: "06:15"
});

export const packingMaterial = Object.freeze({
  id: "material_band_camp_packing",
  required: [
    "instrument",
    "music folder",
    "water",
    "sunscreen",
    "athletic shoes",
    "black shorts"
  ],
  optional: ["hat", "towel"]
});

export const guardianAction = Object.freeze({
  id: "guardian_action_physical_form",
  label: "Complete the band physical form",
  actorId: mattFixture.id,
  dueAt: "2026-07-24T17:00:00-05:00",
  status: "needs_guardian"
});

export const algebraExercise = Object.freeze({
  id: "linear_equation_01",
  prompt: "3(x + 2) = 18",
  expectedFirstStep: "divide_both_sides_by_3",
  intermediateEquation: "x + 2 = 6",
  finalAnswer: 4
});

const sourceAuthoredFields = ["date", "start", "checkIn", "end"] as const;

export function diffBandSource(before: BandCampSource, after: BandCampSource) {
  return sourceAuthoredFields.flatMap((field) =>
    before[field] === after[field]
      ? []
      : [{ field, before: before[field], after: after[field] }]
  );
}
