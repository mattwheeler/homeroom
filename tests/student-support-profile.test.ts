import { describe, expect, it } from "vitest";

import {
  buildStudentSupportPolicy,
  studentSupportProfileSchema
} from "../lib/domain/student-support-profile";

describe("age-aware student support profile", () => {
  it("turns Emily's grade-9 visual profile into enforceable learning supports", () => {
    const profile = studentSupportProfileSchema.parse({
      studentId: "student_emily",
      name: "Emily",
      age: 14,
      grade: 9,
      learningModalities: ["visual", "interactive", "worked_examples"],
      executiveSkills: {
        timeManagement: "developing",
        organization: "developing",
        prioritization: "developing"
      }
    });

    expect(buildStudentSupportPolicy(profile)).toEqual(expect.objectContaining({
      developmentalStage: "early_high_school",
      readingLevel: "grade_7_to_9",
      maxDirectionsAtOnce: 3,
      visualFirst: true,
      attentionSupport: {
        primaryActions: 1,
        nextPreviewItems: 2,
        classChoicesBeforeExpand: 3,
        progressiveDisclosure: true
      },
      requiredExecutiveRoutines: [
        expect.objectContaining({ skill: "time_management", studentAction: expect.any(String) }),
        expect.objectContaining({ skill: "organization", studentAction: expect.any(String) }),
        expect.objectContaining({ skill: "prioritization", studentAction: expect.any(String) })
      ],
      requiredVisualScaffolds: [
        "session_roadmap",
        "visible_timebox",
        "task_chunks",
        "priority_cue",
        "worked_example_or_organizer"
      ]
    }));
  });

  it("reduces visible choices for younger students while keeping one primary action", () => {
    const policy = buildStudentSupportPolicy(studentSupportProfileSchema.parse({
      studentId: "student_emily",
      name: "Emily",
      age: 10,
      grade: 5,
      learningModalities: ["visual"],
      executiveSkills: {
        timeManagement: "emerging",
        organization: "emerging",
        prioritization: "emerging"
      }
    }));

    expect(policy.attentionSupport).toEqual({
      primaryActions: 1,
      nextPreviewItems: 1,
      classChoicesBeforeExpand: 2,
      progressiveDisclosure: true
    });
  });

  it("keeps guardian configuration within plausible K-12 age and grade combinations", () => {
    expect(() => studentSupportProfileSchema.parse({
      studentId: "student_emily",
      name: "Emily",
      age: 8,
      grade: 9,
      learningModalities: ["visual"],
      executiveSkills: {
        timeManagement: "developing",
        organization: "developing",
        prioritization: "developing"
      }
    })).toThrow(/age and grade/i);
  });

  it("requires all three executive-skill profiles and at least one learning modality", () => {
    expect(() => studentSupportProfileSchema.parse({
      studentId: "student_emily",
      name: "Emily",
      age: 14,
      grade: 9,
      learningModalities: [],
      executiveSkills: {
        timeManagement: "developing",
        organization: "developing"
      }
    })).toThrow();
  });
});
