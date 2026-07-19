import type { GuardianInboxStore } from "../storage/guardian-inbox-store";

export async function listGuardianInbox(input: { recipientId: string; store: GuardianInboxStore }) {
  const notifications = await input.store.list(input.recipientId);
  return { notifications, unreadCount: notifications.filter((item) => item.readAt === null).length };
}

export async function acknowledgeGuardianNotification(input: {
  recipientId: string;
  notificationId: string;
  store: GuardianInboxStore;
  now?: () => Date;
}) {
  const record = await input.store.acknowledge(
    input.recipientId,
    input.notificationId,
    (input.now ?? (() => new Date()))().toISOString()
  );
  if (!record) throw new Error("The guardian reminder was not found.");
  return record;
}

export async function buildGuardianDigest(input: {
  recipientId: string;
  recipientEmail: string;
  store: GuardianInboxStore;
  now?: () => Date;
  randomUUID?: () => string;
}) {
  const now = (input.now ?? (() => new Date()))();
  const notifications = await input.store.list(input.recipientId);
  const subject = "Homeroom weekly family notes";
  const lines = notifications.length > 0
    ? notifications.map((item) => `• ${item.message}\n  ${item.sourceLabel}`).join("\n\n")
    : "No student-approved family notes this week.";
  const text = `${subject}\n\n${lines}\n\nOnly notes your student explicitly sent are included. Private schoolwork and coaching stay private.`;
  await input.store.recordDigest({
    id: input.randomUUID?.() ?? crypto.randomUUID(),
    recipientId: input.recipientId,
    recipientEmail: input.recipientEmail,
    notificationIds: notifications.map((item) => item.id),
    status: "previewed",
    providerMessageId: null,
    createdAt: now.toISOString()
  });
  return { subject, text, recipientEmail: input.recipientEmail, notificationIds: notifications.map((item) => item.id) };
}
