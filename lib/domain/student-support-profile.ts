import { z } from "zod";

const learningModalitySchema = z.enum([
  "visual",
  "interactive",
  "worked_examples",
  "verbal",
  "reading_writing"
]);

const executiveSkillLevelSchema = z.enum(["emerging", "developing", "independent"]);

export const studentSupportProfileSchema = z.object({
  studentId: z.string().min(1).max(160),
  name: z.string().min(1).max(80),
  age: z.number().int().min(5).max(19),
  grade: z.number().int().min(0).max(12),
  learningModalities: z.array(learningModalitySchema).min(1).max(5),
  executiveSkills: z.object({
    timeManagement: executiveSkillLevelSchema,
    organization: executiveSkillLevelSchema,
    prioritization: executiveSkillLevelSchema
  }).strict()
}).strict().superRefine((profile, context) => {
  if (profile.age < profile.grade + 4 || profile.age > profile.grade + 7) {
    context.addIssue({
      code: "custom",
      path: ["age"],
      message: "The student's age and grade must form a plausible K-12 profile."
    });
  }
  if (new Set(profile.learningModalities).size !== profile.learningModalities.length) {
    context.addIssue({
      code: "custom",
      path: ["learningModalities"],
      message: "Learning modalities must be unique."
    });
  }
});

export type StudentSupportProfile = z.infer<typeof studentSupportProfileSchema>;
export type ExecutiveSkill = "time_management" | "organization" | "prioritization";
export type VisualScaffold =
  | "session_roadmap"
  | "visible_timebox"
  | "task_chunks"
  | "priority_cue"
  | "worked_example_or_organizer";

export interface StudentSupportPolicy {
  developmentalStage: "elementary" | "middle_school" | "early_high_school" | "upper_high_school";
  readingLevel: "grade_3_to_5" | "grade_6_to_8" | "grade_7_to_9" | "grade_9_to_12";
  maxDirectionsAtOnce: 2 | 3;
  visualFirst: boolean;
  attentionSupport: {
    primaryActions: 1;
    nextPreviewItems: 1 | 2;
    classChoicesBeforeExpand: 2 | 3;
    progressiveDisclosure: true;
  };
  requiredExecutiveRoutines: ReadonlyArray<{
    skill: ExecutiveSkill;
    label: string;
    studentAction: string;
    adultBoundary: string;
  }>;
  requiredVisualScaffolds: ReadonlyArray<VisualScaffold>;
}

export const emilyStudentSupportProfile: StudentSupportProfile = studentSupportProfileSchema.parse({
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

export function buildStudentSupportPolicy(profile: StudentSupportProfile): StudentSupportPolicy {
  const developmentalStage = profile.grade <= 5
    ? "elementary" as const
    : profile.grade <= 8
      ? "middle_school" as const
      : profile.grade <= 10
        ? "early_high_school" as const
        : "upper_high_school" as const;
  const readingLevel = profile.grade <= 5
    ? "grade_3_to_5" as const
    : profile.grade <= 8
      ? "grade_6_to_8" as const
      : profile.grade <= 10
        ? "grade_7_to_9" as const
        : "grade_9_to_12" as const;

  return {
    developmentalStage,
    readingLevel,
    maxDirectionsAtOnce: developmentalStage === "elementary" ? 2 : 3,
    visualFirst: profile.learningModalities.includes("visual"),
    attentionSupport: {
      primaryActions: 1,
      nextPreviewItems: developmentalStage === "elementary" ? 1 : 2,
      classChoicesBeforeExpand: developmentalStage === "elementary" ? 2 : 3,
      progressiveDisclosure: true
    },
    requiredExecutiveRoutines: [
      {
        skill: "time_management",
        label: "Plan the time",
        studentAction: "Choose a timebox, watch progress, and compare the estimate with the time used.",
        adultBoundary: "Homeroom suggests and reflects; the student owns the choice."
      },
      {
        skill: "organization",
        label: "Set up the work",
        studentAction: "Name the goal, gather what is needed, and work through visible task chunks.",
        adultBoundary: "Homeroom structures the workspace without doing the work."
      },
      {
        skill: "prioritization",
        label: "Choose what matters next",
        studentAction: "Use due date, importance, effort, and readiness to select one next action.",
        adultBoundary: "Homeroom explains the rationale and preserves student agency."
      }
    ],
    requiredVisualScaffolds: [
      "session_roadmap",
      "visible_timebox",
      "task_chunks",
      "priority_cue",
      "worked_example_or_organizer"
    ]
  };
}
