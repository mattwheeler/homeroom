import type { D1DatabaseLike } from "./session-store";

export interface GuardianNotification {
  id: string;
  recipientId: string;
  studentId: string;
  title: string;
  message: string;
  taskLabel: string;
  sourceLabel: string;
  sentAt: string;
  readAt: string | null;
}

export interface GuardianInboxStore {
  list(recipientId: string): Promise<GuardianNotification[]>;
  acknowledge(recipientId: string, id: string, readAt: string): Promise<GuardianNotification | null>;
  recordDigest(input: {
    id: string;
    recipientId: string;
    recipientEmail: string;
    notificationIds: string[];
    status: "previewed" | "sent" | "failed";
    providerMessageId: string | null;
    createdAt: string;
  }): Promise<void>;
}

export interface GuardianDigestRecipient {
  recipientId: string;
  recipientEmail: string;
}

interface AggregateRow { records_json: string; }

function parseNotification(row: Record<string, unknown>): GuardianNotification | null {
  try {
    const payload = JSON.parse(String(row.notification_json ?? "{}")) as Record<string, unknown>;
    const task = payload.task && typeof payload.task === "object" ? payload.task as Record<string, unknown> : {};
    const source = payload.source && typeof payload.source === "object" ? payload.source as Record<string, unknown> : {};
    return {
      id: String(row.id),
      recipientId: String(row.recipient_id),
      studentId: String(row.student_id || payload.studentId || ""),
      title: String(payload.title ?? payload.taskLabel ?? task.label ?? "A family note needs your attention"),
      message: String(payload.message ?? payload.body ?? ""),
      taskLabel: String(payload.taskLabel ?? task.label ?? "Family note"),
      sourceLabel: String(payload.sourceLabel ?? source.label ?? "Student-approved reminder"),
      sentAt: String(row.sent_at),
      readAt: row.read_at ? String(row.read_at) : null
    };
  } catch {
    return null;
  }
}

export class D1GuardianInboxStore implements GuardianInboxStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async list(recipientId: string): Promise<GuardianNotification[]> {
    const row = await this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'id', n.id, 'recipient_id', n.recipient_id,
        'student_id', COALESCE(s.student_id, s.actor_id),
        'notification_json', n.notification_json, 'sent_at', n.sent_at, 'read_at', n.read_at
      )), '[]') AS records_json
      FROM guardian_notifications n
      JOIN demo_sessions s ON s.id = n.session_id
      WHERE n.recipient_id = ? ORDER BY n.sent_at DESC`
    ).bind(recipientId).first<AggregateRow>();
    return (JSON.parse(row?.records_json ?? "[]") as Record<string, unknown>[])
      .map(parseNotification)
      .filter((item): item is GuardianNotification => item !== null);
  }

  async acknowledge(recipientId: string, id: string, readAt: string): Promise<GuardianNotification | null> {
    const result = await this.database.prepare(
      "UPDATE guardian_notifications SET read_at = ? WHERE id = ? AND recipient_id = ? AND read_at IS NULL"
    ).bind(readAt, id, recipientId).run();
    if (!result.success) return null;
    return (await this.list(recipientId)).find((item) => item.id === id) ?? null;
  }

  async recordDigest(input: Parameters<GuardianInboxStore["recordDigest"]>[0]): Promise<void> {
    const result = await this.database.prepare(
      `INSERT INTO guardian_digest_deliveries (
        id, recipient_id, recipient_email, notification_ids_json, status, provider_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      input.id,
      input.recipientId,
      input.recipientEmail,
      JSON.stringify(input.notificationIds),
      input.status,
      input.providerMessageId,
      input.createdAt
    ).run();
    if (!result.success) throw new Error("The guardian digest delivery could not be recorded.");
  }

  async listDigestRecipients(): Promise<GuardianDigestRecipient[]> {
    const row = await this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'recipientId', p.id, 'recipientEmail', p.email
      )), '[]') AS records_json
      FROM principals p
      WHERE p.role = 'guardian' AND EXISTS (
        SELECT 1 FROM guardian_notifications n WHERE n.recipient_id = p.id
      )`
    ).bind().first<AggregateRow>();
    return JSON.parse(row?.records_json ?? "[]") as GuardianDigestRecipient[];
  }
}
