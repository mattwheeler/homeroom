import { describe, expect, it } from "vitest";

import {
  getLearningTrack,
  learningTracks
} from "../lib/domain/learning-tracks";

describe("course-linked Learning tracks", () => {
  it("maps every upcoming ninth-grade class to an approved readiness mission", () => {
    expect(learningTracks).toHaveLength(7);
    expect(learningTracks.map((track) => track.courseName)).toEqual([
      "English I",
      "Algebra I",
      "Biology",
      "World Geography",
      "Concert and Marching Band",
      "Art I",
      "Spanish I"
    ]);
    expect(learningTracks.map((track) => track.mission.source.kind))
      .toEqual(Array(7).fill("homeroom_readiness"));
    expect(new Set(learningTracks.map((track) => track.mission.objectiveId)).size).toBe(7);
  });

  it("provides subject-specific pedagogy instead of a generic quiz", () => {
    expect(getLearningTrack("course_algebra_1")).toMatchObject({
      trackTitle: "Starting Strong in Algebra I",
      coachMode: "guided_problem_solving",
      mission: {
        title: "Equations stay balanced",
        suggestedMinutes: 10
      }
    });
    expect(getLearningTrack("course_english_1").coachMode).toBe("claim_evidence_dialogue");
    expect(getLearningTrack("course_spanish_1").coachMode).toBe("conversation_retrieval");
  });

  it("rejects a class that is not in Emily's imported course set", () => {
    expect(() => getLearningTrack("course_chemistry")).toThrow(/approved course/i);
  });
});
