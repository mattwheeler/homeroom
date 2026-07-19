"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./guardian-inbox.module.css";

interface Notification {
  id: string; title: string; message: string; sourceLabel: string; sentAt: string; readAt: string | null;
}

export function GuardianInbox({ csrfToken }: { csrfToken: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [digest, setDigest] = useState("");
  const [message, setMessage] = useState("");

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
      if (active) setNotifications(data.notifications ?? []);
    }).catch((error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [call]);

  async function acknowledge(id: string) {
    try {
      const updated = await call({ action: "acknowledge", notificationId: id });
      setNotifications((current) => current.map((item) => item.id === id ? updated : item));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to acknowledge this note."); }
  }

  async function previewDigest() {
    try {
      const data = await call({ action: "digest" });
      setDigest(data.text ?? "");
      setMessage("This is exactly what the weekly email contains—only notes Emily chose to send.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to build the digest."); }
  }

  async function sendDigest() {
    try {
      const data = await call({ action: "send_digest" });
      setMessage(data.sent ? "Weekly family email sent." : "The weekly family email was not sent.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to send the weekly email."); }
  }

  const unread = notifications.filter((item) => !item.readAt).length;
  return (
    <section className={styles.inbox} id="guardian-inbox" aria-labelledby="guardian-inbox-title">
      <header className={styles.head}>
        <div><p>FAMILY INBOX</p><h2 id="guardian-inbox-title">Notes Emily chose to send</h2></div>
        <div><button type="button" onClick={() => void previewDigest()}>Preview weekly email</button> <button type="button" onClick={() => void sendDigest()}>Email digest now</button></div>
      </header>
      <p className={styles.summary}>{unread === 0 ? "No unread notes." : `${unread} note${unread === 1 ? "" : "s"} waiting for you.`} Private coaching and answers are never included.</p>
      <div className={styles.list}>
        {notifications.length === 0 && <p>No family notes yet. When Emily asks for help, the exact preview she approves will appear here.</p>}
        {notifications.map((item) => <article className={`${styles.card} ${item.readAt ? styles.read : ""}`} key={item.id}>
          <div><h3>{item.title}</h3><p>{item.message}</p><small>{item.sourceLabel} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.sentAt))}</small></div>
          {!item.readAt && <button type="button" onClick={() => void acknowledge(item.id)}>Acknowledge</button>}
        </article>)}
      </div>
      {digest && <div className={styles.digest}>{digest}</div>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
