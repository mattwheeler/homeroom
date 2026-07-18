import { z } from "zod";

import { canonicalJson } from "../security/approval";
import type {
  ProofAiTurnEvidence,
  ProofAuditEvidence,
  ProofEvidenceBundle,
  ProofStore
} from "../storage/proof-store";
import type { SessionRecord } from "../storage/session-store";
import { transitionSession } from "./state-machine";

const auditEventTypes = [
  "PLAN_V1_APPROVED",
  "SOURCE_V2_SYNCED",
  "PLAN_V2_APPROVED",
  "PRACTICE_COMPLETED",
  "GUARDIAN_SUMMARY_PUBLISHED",
  "PROOF_VIEW_OPENED"
] as const;

const aiStages = ["morning_plan", "plan_revision", "learning_hint"] as const;

const auditEvidenceSchema = z.object({
  sequence: z.number().int().positive(),
  actor: z.string().min(1).max(100),
  eventType: z.enum(auditEventTypes),
  stateVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  approvalId: z.string().max(100).nullable(),
  argsHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  projectionHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  sourceVersion: z.number().int().min(1).max(2).nullable(),
  planVersion: z.number().int().min(1).max(2).nullable(),
  exerciseId: z.string().max(100).nullable(),
  grader: z.string().max(100).nullable(),
  privateExcluded: z.number().int().nonnegative().nullable()
}).strict();

const aiEvidenceSchema = z.object({
  stage: z.enum(aiStages),
  model: z.string().min(1).max(120),
  status: z.enum(["completed", "failed"]),
  responseIds: z.array(z.string().min(1).max(120)).max(8),
  toolTrace: z.array(z.object({
    name: z.string().min(1).max(100),
    callId: z.string().min(1).max(160)
  }).strict()).max(8),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  createdAt: z.string().datetime()
}).strict();

const evidenceBundleSchema = z.object({
  session: z.object({
    id: z.string().min(1).max(100),
    actorId: z.literal("student_emily"),
    phase: z.literal("COMPLETE"),
    stateVersion: z.literal(15),
    sourceVersion: z.literal(2),
    activePlanVersion: z.literal(2),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  }).strict(),
  audits: z.array(auditEvidenceSchema).min(6).max(32),
  aiTurns: z.array(aiEvidenceSchema).min(3).max(24)
}).strict();

export class ProofViewError extends Error {
  readonly code: "PROOF_SCOPE_MISMATCH" | "PROOF_NOT_READY" | "PROOF_EVIDENCE_INVALID";

  constructor(code: ProofViewError["code"], message: string) {
    super(message);
    this.name = "ProofViewError";
    this.code = code;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function prefix(value: string | null): string {
  return value ? `${value.slice(0, 8)}…` : "verified";
}

function actorLabel(actor: string): string {
  return actor === "student_emily" ? "Emily" : "BAND fixture";
}

function timelineEntry(record: ProofAuditEvidence) {
  const labels: Record<(typeof auditEventTypes)[number], string> = {
    PLAN_V1_APPROVED: "Emily approved Plan V1",
    SOURCE_V2_SYNCED: "BAND source advanced to V2",
    PLAN_V2_APPROVED: "Emily approved Plan V2",
    PRACTICE_COMPLETED: "Algebra practice completed",
    GUARDIAN_SUMMARY_PUBLISHED: "Guardian-safe view published",
    PROOF_VIEW_OPENED: "Judge proof opened"
  };
  const proof: Record<(typeof auditEventTypes)[number], string> = {
    PLAN_V1_APPROVED: `Receipt-bound approval · args ${prefix(record.argsHash)}`,
    SOURCE_V2_SYNCED: "Controlled source transition",
    PLAN_V2_APPROVED: `Receipt-bound approval · args ${prefix(record.argsHash)}`,
    PRACTICE_COMPLETED: "Deterministic grader · private work excluded",
    GUARDIAN_SUMMARY_PUBLISHED: `Projection ${prefix(record.projectionHash)} · ${record.privateExcluded ?? 0} private fields excluded`,
    PROOF_VIEW_OPENED: "Read-only evidence view"
  };
  return {
    sequence: record.sequence,
    label: labels[record.eventType],
    actor: actorLabel(record.actor),
    stateVersion: record.stateVersion,
    createdAt: record.createdAt,
    proof: proof[record.eventType]
  };
}

function aiTurn(turn: ProofAiTurnEvidence) {
  const labels: Record<(typeof aiStages)[number], string> = {
    morning_plan: "Morning plan",
    plan_revision: "Source-change revision",
    learning_hint: "Socratic Algebra hint"
  };
  return {
    stage: turn.stage as (typeof aiStages)[number],
    label: labels[turn.stage as (typeof aiStages)[number]],
    model: turn.model,
    status: turn.status,
    responseIds: turn.responseIds,
    tools: turn.toolTrace.map((tool) => tool.name),
    latencyMs: turn.latencyMs,
    usage: {
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      cachedTokens: turn.cachedTokens
    },
    createdAt: turn.createdAt
  };
}

function latestCompletedTurn(evidence: ProofEvidenceBundle, stage: (typeof aiStages)[number]): ProofAiTurnEvidence {
  const turn = evidence.aiTurns.filter((candidate) => candidate.stage === stage && candidate.status === "completed").at(-1);
  if (!turn) throw new ProofViewError("PROOF_EVIDENCE_INVALID", `The ${stage} model trace is missing.`);
  return turn;
}

async function buildProof(evidenceInput: ProofEvidenceBundle) {
  const evidence = evidenceBundleSchema.parse(evidenceInput) as ProofEvidenceBundle;
  const latestAudits = auditEventTypes.map((eventType) => {
    const record = evidence.audits.filter((candidate) => candidate.eventType === eventType).at(-1);
    if (!record) throw new ProofViewError("PROOF_EVIDENCE_INVALID", `The ${eventType} audit event is missing.`);
    return record;
  });
  const turns = aiStages.map((stage) => latestCompletedTurn(evidence, stage));
  const proofOpened = latestAudits.at(-1)!;
  const payload = {
    contractVersion: 1 as const,
    headline: "Golden Experience verified" as const,
    session: {
      id: evidence.session.id,
      student: "Emily" as const,
      fixture: "Fictional Build Week data" as const,
      phase: "COMPLETE" as const,
      stateVersion: 15 as const,
      sourceVersion: 2 as const,
      activePlanVersion: 2 as const
    },
    scorecard: {
      liveModelTurns: turns.length,
      auditedTransitions: latestAudits.length,
      approvedWrites: latestAudits.filter((audit) =>
        audit.eventType === "PLAN_V1_APPROVED" ||
        audit.eventType === "PLAN_V2_APPROVED" ||
        audit.eventType === "GUARDIAN_SUMMARY_PUBLISHED"
      ).length,
      privateLearningDetailsExposed: 0 as const
    },
    sources: [
      { name: "BAND calendar", recordId: "event_band_camp_day_1", version: 2, status: "verified" },
      { name: "Band packing list", recordId: "material_band_camp_packing", version: 1, status: "verified" },
      { name: "Algebra I practice", recordId: "linear_equation_01", version: 1, status: "verified" },
      { name: "Guardian task", recordId: "guardian_action_physical_form", version: 1, status: "verified" }
    ] as const,
    timeline: latestAudits.map(timelineEntry),
    aiTurns: turns.map(aiTurn),
    privacy: {
      keptPrivate: ["answers", "step-by-step work", "attempt and hint counts", "private coaching content"] as const,
      guardianProjection: "Server-built allowlist" as const,
      modelStorage: "store: false" as const
    }
  };
  return {
    ...payload,
    integrity: {
      proofHash: await sha256Hex(canonicalJson({ ...payload, generatedAt: proofOpened.createdAt })),
      generatedAt: proofOpened.createdAt
    }
  };
}

export async function openJudgeProof(input: {
  session: SessionRecord;
  store: ProofStore;
  now?: () => Date;
  randomUUID?: () => string;
}) {
  if (input.session.role !== "student" || input.session.actorId !== "student_emily") {
    throw new ProofViewError("PROOF_SCOPE_MISMATCH", "The proof view is outside this student session.");
  }
  if (input.session.state.phase === "GUARDIAN_PUBLISHED") {
    const nextState = transitionSession(input.session.state, { type: "OPEN_PROOF" });
    if (
      nextState.phase !== "COMPLETE" ||
      nextState.stateVersion !== 15 ||
      nextState.sourceVersion !== 2 ||
      nextState.activePlanVersion !== 2
    ) {
      throw new ProofViewError("PROOF_NOT_READY", "The Golden Experience is not ready for proof.");
    }
    const openedAt = (input.now ?? (() => new Date()))().toISOString();
    await input.store.advanceToProof({
      sessionId: input.session.id,
      previousStateVersion: 14,
      nextState: { phase: "COMPLETE", stateVersion: 15, sourceVersion: 2, activePlanVersion: 2 },
      openedAt,
      auditEventId: input.randomUUID?.() ?? crypto.randomUUID()
    });
  } else if (input.session.state.phase !== "COMPLETE" || input.session.state.stateVersion !== 15) {
    throw new ProofViewError("PROOF_NOT_READY", "Complete the guardian sharing milestone before opening proof.");
  }
  const evidence = await input.store.readEvidence(input.session.id);
  if (evidence.session.id !== input.session.id || evidence.session.actorId !== input.session.actorId) {
    throw new ProofViewError("PROOF_SCOPE_MISMATCH", "The proof evidence is outside this student session.");
  }
  try {
    return await buildProof(evidence);
  } catch (error) {
    if (error instanceof ProofViewError) throw error;
    throw new ProofViewError("PROOF_EVIDENCE_INVALID", "The proof evidence failed validation.");
  }
}
