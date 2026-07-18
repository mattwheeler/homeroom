import { algebraExercise } from "./fixtures";
import { transitionSession } from "./state-machine";
import type {
  PracticeStep,
  PracticeStore
} from "../storage/practice-store";
import type { SessionRecord } from "../storage/session-store";

export type FirstStepAnswer =
  | "divide_both_sides_by_3"
  | "subtract_3"
  | "multiply_both_sides_by_3";

export type PracticeAttempt =
  | { kind: "first_step"; answer: FirstStepAnswer }
  | { kind: "final_answer"; answer: string };

export class PracticeDomainError extends Error {
  readonly code: "PRACTICE_SCOPE_MISMATCH" | "PRACTICE_NOT_FOUND" | "PRACTICE_OUT_OF_ORDER";

  constructor(code: PracticeDomainError["code"], message: string) {
    super(message);
    this.name = "PracticeDomainError";
    this.code = code;
  }
}

function assertStudentScope(session: SessionRecord): void {
  if (session.role !== "student" || session.actorId !== "student_emily") {
    throw new PracticeDomainError("PRACTICE_SCOPE_MISMATCH", "The exercise is outside this student session.");
  }
}

export async function startPracticeSession(input: {
  session: SessionRecord;
  store: PracticeStore;
  now?: () => Date;
}) {
  assertStudentScope(input.session);
  const nextState = transitionSession(input.session.state, { type: "REQUEST_HINT" });
  if (
    nextState.phase !== "HINT_USED" ||
    nextState.sourceVersion !== 2 ||
    nextState.activePlanVersion !== 2
  ) {
    throw new PracticeDomainError("PRACTICE_OUT_OF_ORDER", "Practice requires active Plan V2.");
  }
  const startedAt = (input.now ?? (() => new Date()))().toISOString();
  await input.store.startPractice({
    sessionId: input.session.id,
    previousStateVersion: input.session.state.stateVersion,
    nextState: { ...nextState, phase: "HINT_USED", sourceVersion: 2, activePlanVersion: 2 },
    exerciseId: algebraExercise.id,
    startedAt
  });
  return {
    exercise: {
      id: algebraExercise.id,
      course: "Algebra I" as const,
      prompt: algebraExercise.prompt
    },
    progress: {
      hintsUsed: 1 as const,
      attempts: 0,
      stateVersion: nextState.stateVersion
    }
  };
}

export async function submitPracticeAttempt(input: {
  session: SessionRecord;
  store: PracticeStore;
  attempt: PracticeAttempt;
  now?: () => Date;
  randomUUID?: () => string;
}) {
  assertStudentScope(input.session);
  if (
    input.session.state.phase !== "HINT_USED" ||
    input.session.state.sourceVersion !== 2 ||
    input.session.state.activePlanVersion !== 2
  ) {
    throw new PracticeDomainError("PRACTICE_OUT_OF_ORDER", "The practice attempt is not current.");
  }
  const progress = await input.store.findProgress(input.session.id, algebraExercise.id);
  if (!progress || progress.status !== "in_progress" || progress.hintsUsed !== 1) {
    throw new PracticeDomainError("PRACTICE_NOT_FOUND", "The active practice exercise was not found.");
  }
  const nextAttempts = progress.attempts + 1;

  if (input.attempt.kind === "first_step") {
    if (progress.validatedSteps.length > 0) {
      throw new PracticeDomainError("PRACTICE_OUT_OF_ORDER", "The first step has already been validated.");
    }
    const correct = input.attempt.answer === algebraExercise.expectedFirstStep;
    const nextValidatedSteps: PracticeStep[] = correct ? ["divide_both_sides_by_3"] : [];
    await input.store.recordAttempt({
      sessionId: input.session.id,
      exerciseId: algebraExercise.id,
      expectedAttempts: progress.attempts,
      expectedValidatedSteps: progress.validatedSteps,
      nextAttempts,
      nextValidatedSteps
    });
    if (!correct) {
      return {
        correct: false as const,
        completed: false as const,
        feedback: "That changes the equation in a different way. Look for the operation that undoes multiplication.",
        proof: {
          grader: "homeroom-deterministic-v1" as const,
          attempts: nextAttempts,
          stateVersion: input.session.state.stateVersion
        }
      };
    }
    return {
      correct: true as const,
      completed: false as const,
      equation: algebraExercise.intermediateEquation,
      feedback: "Exactly. You used the inverse operation on both sides.",
      next: {
        kind: "final_answer" as const,
        prompt: "What operation undoes +2? What is x?"
      },
      proof: {
        grader: "homeroom-deterministic-v1" as const,
        attempts: nextAttempts,
        stateVersion: input.session.state.stateVersion
      }
    };
  }

  if (!progress.validatedSteps.includes("divide_both_sides_by_3")) {
    throw new PracticeDomainError("PRACTICE_OUT_OF_ORDER", "Complete and validate the first step before the final answer.");
  }
  const normalizedAnswer = input.attempt.answer.trim();
  const correct = /^-?\d+(?:\.\d+)?$/.test(normalizedAnswer) && Number(normalizedAnswer) === algebraExercise.finalAnswer;
  if (!correct) {
    await input.store.recordAttempt({
      sessionId: input.session.id,
      exerciseId: algebraExercise.id,
      expectedAttempts: progress.attempts,
      expectedValidatedSteps: progress.validatedSteps,
      nextAttempts,
      nextValidatedSteps: progress.validatedSteps
    });
    return {
      correct: false as const,
      completed: false as const,
      feedback: "Not quite. Check which operation undoes adding 2, then try again.",
      proof: {
        grader: "homeroom-deterministic-v1" as const,
        attempts: nextAttempts,
        stateVersion: input.session.state.stateVersion
      }
    };
  }

  const nextState = transitionSession(input.session.state, {
    type: "COMPLETE_PRACTICE",
    graderVerified: true
  });
  if (
    nextState.phase !== "PRACTICE_COMPLETE" ||
    nextState.sourceVersion !== 2 ||
    nextState.activePlanVersion !== 2
  ) {
    throw new PracticeDomainError("PRACTICE_OUT_OF_ORDER", "The exercise could not be completed.");
  }
  const completedAt = (input.now ?? (() => new Date()))().toISOString();
  const nextValidatedSteps: PracticeStep[] = ["divide_both_sides_by_3", "final_answer_4"];
  await input.store.completePractice({
    sessionId: input.session.id,
    previousStateVersion: input.session.state.stateVersion,
    nextState: { ...nextState, phase: "PRACTICE_COMPLETE", sourceVersion: 2, activePlanVersion: 2 },
    exerciseId: algebraExercise.id,
    expectedAttempts: progress.attempts,
    expectedValidatedSteps: progress.validatedSteps,
    nextAttempts,
    nextValidatedSteps,
    finalAnswer: normalizedAnswer,
    completedAt,
    auditEventId: input.randomUUID?.() ?? crypto.randomUUID()
  });
  return {
    correct: true as const,
    completed: true as const,
    answer: "x = 4" as const,
    celebration: "You solved it one step at a time." as const,
    proof: {
      grader: "homeroom-deterministic-v1" as const,
      exerciseId: algebraExercise.id,
      hintsUsed: progress.hintsUsed,
      attempts: nextAttempts,
      stateVersion: nextState.stateVersion,
      completedAt
    }
  };
}
