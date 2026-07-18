import { describe, expect, it } from "vitest";
import {
  algebraExercise,
  bandCampV1,
  bandCampV2,
  courseFixtures,
  diffBandSource,
  emilyFixture,
  mattFixture
} from "../lib/domain/fixtures";

describe("emily_band_camp_v1 fixtures", () => {
  it("contains the approved fictional student and guardian", () => {
    expect(emilyFixture).toMatchObject({ name: "Emily", age: 14, grade: 9 });
    expect(mattFixture).toMatchObject({ id: "guardian_matt", name: "Matt" });
  });

  it("contains exactly seven approved courses", () => {
    expect(courseFixtures.map((course) => course.name)).toEqual([
      "English I",
      "Algebra I",
      "Biology",
      "World Geography",
      "Concert and Marching Band",
      "Art I",
      "Spanish I"
    ]);
  });

  it("changes only check-in time between band source versions", () => {
    expect(diffBandSource(bandCampV1, bandCampV2)).toEqual([
      { field: "checkIn", before: "07:30", after: "07:15" }
    ]);
    expect(bandCampV1.departure).toBe("07:00");
    expect(bandCampV2.departure).toBe("06:45");
  });

  it("keeps algebra grading deterministic", () => {
    expect(algebraExercise).toMatchObject({
      id: "linear_equation_01",
      expectedFirstStep: "divide_both_sides_by_3",
      finalAnswer: 4
    });
  });
});
