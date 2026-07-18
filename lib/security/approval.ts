export type ApprovalErrorCode =
  | "APPROVAL_EXPIRED"
  | "ARGUMENT_MISMATCH"
  | "VERSION_MISMATCH"
  | "INVALID_RECEIPT";

export class ApprovalError extends Error {
  constructor(readonly code: ApprovalErrorCode, message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

export interface VersionExpectation {
  stateVersion: number;
  sourceVersion: number;
  planVersion: number;
}

export interface PendingAction {
  id: string;
  sessionId: string;
  actor: string;
  actionType: string;
  argsHash: string;
  expected: VersionExpectation;
  nonceHash: string;
  idempotencyKey: string;
  expiresAt: number;
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Only finite numbers can be approved.");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Only plain objects can be approved.");
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => {
          if (nested === undefined) throw new TypeError("Undefined values cannot be approved.");
          return [key, normalize(nested)];
        })
    );
  }
  throw new TypeError("Unsupported approval argument type.");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function createPendingAction(input: {
  sessionId: string;
  actor: string;
  actionType: string;
  args: unknown;
  expected: VersionExpectation;
  nowMs: number;
  ttlMs?: number;
  nonce?: string;
}) {
  const receipt = input.nonce ?? crypto.randomUUID() + crypto.randomUUID();
  const argsHash = await sha256(
    canonicalJson({ actor: input.actor, actionType: input.actionType, args: input.args, expected: input.expected })
  );
  const idempotencyKey = await sha256(input.sessionId + ":" + input.actionType + ":" + argsHash);
  const pending: PendingAction = {
    id: "action_" + idempotencyKey.slice(0, 24),
    sessionId: input.sessionId,
    actor: input.actor,
    actionType: input.actionType,
    argsHash,
    expected: { ...input.expected },
    nonceHash: await sha256(receipt),
    idempotencyKey,
    expiresAt: input.nowMs + (input.ttlMs ?? 300_000)
  };
  return { pending, receipt };
}

export async function verifyApproval(input: {
  pending: PendingAction;
  receipt: string;
  args: unknown;
  expected: VersionExpectation;
  nowMs: number;
}) {
  if (input.nowMs > input.pending.expiresAt) {
    throw new ApprovalError("APPROVAL_EXPIRED", "The approval receipt expired.");
  }
  if (canonicalJson(input.expected) !== canonicalJson(input.pending.expected)) {
    throw new ApprovalError("VERSION_MISMATCH", "The approved state versions changed.");
  }
  const argsHash = await sha256(
    canonicalJson({
      actor: input.pending.actor,
      actionType: input.pending.actionType,
      args: input.args,
      expected: input.expected
    })
  );
  if (!constantTimeEqual(argsHash, input.pending.argsHash)) {
    throw new ApprovalError("ARGUMENT_MISMATCH", "The approved arguments changed.");
  }
  const receiptHash = await sha256(input.receipt);
  if (!constantTimeEqual(receiptHash, input.pending.nonceHash)) {
    throw new ApprovalError("INVALID_RECEIPT", "The approval receipt is invalid.");
  }
  return { idempotencyKey: input.pending.idempotencyKey, pendingActionId: input.pending.id };
}
