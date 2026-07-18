import { courseFixtures } from "./fixtures";

export type CourseId = (typeof courseFixtures)[number]["id"];

export type LearningCoachMode =
  | "claim_evidence_dialogue"
  | "guided_problem_solving"
  | "scientific_reasoning"
  | "map_evidence_dialogue"
  | "rhythm_rehearsal"
  | "observation_reflection"
  | "conversation_retrieval";

export interface LearningTrack {
  courseId: CourseId;
  courseName: (typeof courseFixtures)[number]["name"];
  trackTitle: string;
  coachMode: LearningCoachMode;
  mission: {
    id: string;
    title: string;
    objectiveId: string;
    objective: string;
    activityBoundary: string;
    suggestedMinutes: 10;
    source: {
      kind: "homeroom_readiness";
      label: "Homeroom readiness mission";
      version: 1;
    };
  };
}

const source = {
  kind: "homeroom_readiness" as const,
  label: "Homeroom readiness mission" as const,
  version: 1 as const
};

export const learningTracks: readonly LearningTrack[] = Object.freeze([
  {
    courseId: "course_english_1",
    courseName: "English I",
    trackTitle: "Starting Strong in English I",
    coachMode: "claim_evidence_dialogue",
    mission: {
      id: "readiness_english_evidence_01",
      title: "Claims need evidence",
      objectiveId: "english_claim_evidence",
      objective: "Make a clear claim and connect it to relevant textual evidence.",
      activityBoundary: "Use short original passages only; do not invent school assignments or grades.",
      suggestedMinutes: 10,
      source
    }
  },
  {
    courseId: "course_algebra_1",
    courseName: "Algebra I",
    trackTitle: "Starting Strong in Algebra I",
    coachMode: "guided_problem_solving",
    mission: {
      id: "readiness_algebra_balance_01",
      title: "Equations stay balanced",
      objectiveId: "algebra_equation_balance",
      objective: "Explain why the same operation must be applied to both sides of an equation.",
      activityBoundary: "Use original examples, ask for Emily's next step, and never complete a problem for her.",
      suggestedMinutes: 10,
      source
    }
  },
  {
    courseId: "course_biology",
    courseName: "Biology",
    trackTitle: "Starting Strong in Biology",
    coachMode: "scientific_reasoning",
    mission: {
      id: "readiness_biology_variables_01",
      title: "Think like a biologist",
      objectiveId: "biology_variables_evidence",
      objective: "Identify variables and evidence in a simple biological investigation.",
      activityBoundary: "Use fictional, age-appropriate investigations and distinguish observations from conclusions.",
      suggestedMinutes: 10,
      source
    }
  },
  {
    courseId: "course_world_geography",
    courseName: "World Geography",
    trackTitle: "Starting Strong in World Geography",
    coachMode: "map_evidence_dialogue",
    mission: {
      id: "readiness_geography_patterns_01",
      title: "Patterns tell a place's story",
      objectiveId: "geography_spatial_evidence",
      objective: "Use spatial evidence to explain a geographic relationship.",
      activityBoundary: "Use fictional map descriptions and ask Emily to support claims with visible evidence.",
      suggestedMinutes: 10,
      source
    }
  },
  {
    courseId: "course_band",
    courseName: "Concert and Marching Band",
    trackTitle: "Starting Strong in Band",
    coachMode: "rhythm_rehearsal",
    mission: {
      id: "readiness_band_pulse_01",
      title: "Count the pulse",
      objectiveId: "band_rhythm_counting",
      objective: "Count and explain a short four-beat rhythm using a steady pulse.",
      activityBoundary: "Use text rhythm patterns only and do not claim to hear Emily's performance.",
      suggestedMinutes: 10,
      source
    }
  },
  {
    courseId: "course_art_1",
    courseName: "Art I",
    trackTitle: "Starting Strong in Art I",
    coachMode: "observation_reflection",
    mission: {
      id: "readiness_art_observation_01",
      title: "See before you draw",
      objectiveId: "art_observation_composition",
      objective: "Describe how shape, spacing, and contrast influence a composition.",
      activityBoundary: "Invite observation and reflection without judging artistic talent or assigning a grade.",
      suggestedMinutes: 10,
      source
    }
  },
  {
    courseId: "course_spanish_1",
    courseName: "Spanish I",
    trackTitle: "Starting Strong in Spanish I",
    coachMode: "conversation_retrieval",
    mission: {
      id: "readiness_spanish_greetings_01",
      title: "Start a conversation",
      objectiveId: "spanish_introductory_exchange",
      objective: "Participate in a short greeting and introduction using supported recall.",
      activityBoundary: "Use beginner Spanish with immediate, kind clarification and no unsupported fluency claims.",
      suggestedMinutes: 10,
      source
    }
  }
]);

export class LearningTrackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningTrackError";
  }
}

export function getLearningTrack(courseId: string): LearningTrack {
  const track = learningTracks.find((candidate) => candidate.courseId === courseId);
  if (!track) {
    throw new LearningTrackError("The class is not an approved course in Emily's workspace.");
  }
  return track;
}
