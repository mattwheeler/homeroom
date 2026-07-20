"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./guardian-inbox.module.css";

interface Notification {
  id: string; title: string; message: string; sourceLabel: string; sentAt: string; readAt: string | null;
}

export interface DigestDelivery {
  kind: "success" | "failure";
  recipientEmail: string | null;
  occurredAt: string;
  error?: string;
}

export function digestDeliveryConfirmation(delivery: DigestDelivery) {
  const recipient = delivery.recipientEmail || "the configured guardian email";
  return {
    title: delivery.kind === "success" ? "Email digest sent" : "Email digest not sent",
    detail: delivery.kind === "success"
      ? "The email was accepted for delivery."
      : delivery.error || "The email provider did not accept this digest.",
    recipient,
    occurredAt: delivery.occurredAt
  };
}

function deliveryTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(iso));
}

export function DigestDeliveryNotice({ delivery }: { delivery: DigestDelivery }) {
  const confirmation = digestDeliveryConfirmation(delivery);
  return (
    <div
      className={`${styles.deliveryNotice} ${delivery.kind === "success" ? styles.deliverySuccess : styles.deliveryFailure}`}
      role={delivery.kind === "success" ? "status" : "alert"}
      aria-live="polite"
    >
      <span className={styles.deliveryMark} aria-hidden="true">{delivery.kind === "success" ? "✓" : "!"}</span>
      <span>
        <strong>{confirmation.title}</strong>
        <small>{confirmation.detail}</small>
        <small>
          Recipient: {confirmation.recipient} · <time dateTime={confirmation.occurredAt}>{deliveryTime(confirmation.occurredAt)}</time>
        </small>
      </span>
    </div>
  );
}

export function GuardianInbox({ csrfToken }: { csrfToken: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [digest, setDigest] = useState("");
  const [message, setMessage] = useState("");
  const [recipientEmail, setRecipientEmail] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"preview" | "send" | null>(null);
  const [delivery, setDelivery] = useState<DigestDelivery | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const call = useCallback(async (body: object) => {
    const response = await fetch("/api/guardian/inbox", {
      method: "POST",
      headers: { "content-type": "application/json", "x-homeroom-csrf": csrfToken },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "Family notes are unavailable.");
    return data;
  }, [csrfToken]);

  useEffect(() => {
    let active = true;
    void call({ action: "list" }).then((data) => {
      if (active) {
        setNotifications(data.notifications ?? []);
        setRecipientEmail(typeof data.recipientEmail === "string" ? data.recipientEmail : null);
      }
    }).catch((error) => {
      if (active) setMessage(error.message);
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [call]);

  async function acknowledge(id: string) {
    try {
      const updated = await call({ action: "acknowledge", notificationId: id });
      setNotifications((current) => current.map((item) => item.id === id ? updated : item));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to acknowledge this note."); }
  }

  async function previewDigest() {
    setBusyAction("preview");
    setMessage("");
    try {
      const data = await call({ action: "digest" });
      setDigest(data.text ?? "");
      if (typeof data.recipientEmail === "string") setRecipientEmail(data.recipientEmail);
      setMessage("This preview includes only notes Emily chose to send.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to build the digest.");
    } finally {
      setBusyAction(null);
    }
  }

  async function sendDigest() {
    setBusyAction("send");
    setMessage("");
    setDelivery(null);
    try {
      const data = await call({ action: "send_digest" });
      if (!data.sent) throw new Error("The email provider did not accept this digest.");
      const sentRecipient = typeof data.recipientEmail === "string" ? data.recipientEmail : recipientEmail;
      const sentAt = typeof data.sentAt === "string" ? data.sentAt : new Date().toISOString();
      setRecipientEmail(sentRecipient);
      setDelivery({ kind: "success", recipientEmail: sentRecipient, occurredAt: sentAt });
    } catch (error) {
      setDelivery({
        kind: "failure",
        recipientEmail,
        occurredAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unable to send the weekly email."
      });
    } finally {
      setBusyAction(null);
    }
  }

  const unread = notifications.filter((item) => !item.readAt).length;
  return (
    <section className={styles.inbox} id="guardian-inbox" aria-labelledby="guardian-inbox-title" aria-busy={isLoading || busyAction !== null} tabIndex={-1}>
      <header className={styles.head}>
        <div><p>FAMILY INBOX</p><h2 id="guardian-inbox-title">Notes Emily chose to send</h2></div>
        <div>
          <button type="button" disabled={isLoading || busyAction !== null} onClick={() => void previewDigest()}>{busyAction === "preview" ? "Building preview…" : "Preview weekly email"}</button>{" "}
          <button type="button" disabled={isLoading || busyAction !== null} onClick={() => void sendDigest()}>{busyAction === "send" ? "Sending email…" : "Send weekly email now"}</button>
        </div>
      </header>
      <p className={styles.summary}>{isLoading ? "Loading family notes…" : unread === 0 ? "No unread notes." : `${unread} note${unread === 1 ? "" : "s"} waiting for you.`} {!isLoading && "Private coaching and answers are never included."}</p>
      <div className={styles.list}>
        {notifications.length === 0 && <p>No family notes yet. Messages Emily sends will appear here.</p>}
        {notifications.map((item) => <article className={`${styles.card} ${item.readAt ? styles.read : ""}`} key={item.id}>
          <div><h3>{item.title}</h3><p>{item.message}</p><small>{item.sourceLabel} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.sentAt))}</small></div>
          {!item.readAt && <button type="button" onClick={() => void acknowledge(item.id)}>Mark as read</button>}
        </article>)}
      </div>
      {digest && <div className={styles.digest}>{digest}</div>}
      {delivery && <DigestDeliveryNotice delivery={delivery} />}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
