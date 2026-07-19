"use client";

import { useState } from "react";

import type { StudentSourceProjection } from "../../lib/domain/student-source-projection";
import { StudentOutboundGuard } from "./student-outbound-guard";
import styles from "./student-supplies.module.css";

export function StudentSupplies({ projection }: { projection: StudentSourceProjection }) {
  const lists = projection.supplies ?? [];
  const [ready, setReady] = useState<string[]>([]);

  function toggle(itemId: string) {
    setReady((current) => current.includes(itemId)
      ? current.filter((candidate) => candidate !== itemId)
      : [...current, itemId]
    );
  }

  return (
    <section className={styles.shell} aria-labelledby="student-supplies-title">
      <header className={styles.intro}>
        <div>
          <p>SUPPLIES · SOURCE BACKED</p>
          <h2 id="student-supplies-title">Know what you need. Check what you have.</h2>
          <span>Every line below comes from a page your guardian connected.</span>
        </div>
        <span className={styles.proof}>✓ No AI-generated items</span>
      </header>

      {lists.length === 0 ? (
        <section className={styles.empty}>
          <span aria-hidden="true">▤</span>
          <h3>No official list is connected yet.</h3>
          <p>A guardian can add a school or course supply-list page. Until then, Homeroom will not guess what you need.</p>
        </section>
      ) : (
        <div className={styles.lists}>
          {lists.map((list) => (
            <article className={styles.card} key={list.id}>
              <header>
                <div><p>From your school’s official list</p><h3>{list.title}</h3></div>
                {list.outbound.available && (
                  <StudentOutboundGuard policy={list.outbound.policy} resourceLabel="official supply page" />
                )}
              </header>
              <ul>
                {list.items.map((item) => {
                  if (item.kind === "group_label") {
                    return <li key={item.id} className={styles.groupLabel}><strong>{item.text}</strong></li>;
                  }
                  if (item.kind === "separator") {
                    return <li key={item.id} className={styles.separator} aria-hidden="true"><span>{item.text}</span></li>;
                  }
                  const checked = ready.includes(item.id);
                  return <li key={item.id} className={checked ? styles.checked : ""}>
                    <button type="button" aria-pressed={checked} onClick={() => toggle(item.id)}>
                      <i aria-hidden="true">{checked ? "✓" : ""}</i>
                      <span><strong>{item.text}</strong><small>{item.quantity === null ? "Quantity not specified by the source" : `Quantity: ${item.quantity}`}</small></span>
                    </button>
                  </li>;
                })}
              </ul>
              <footer>
                <span>{ready.filter((id) => list.items.some((item) => item.id === id && item.kind === "item")).length} of {list.items.filter((item) => item.kind === "item").length} marked ready</span>
                <small>Homeroom did not add or guess any item. Your checkmarks organize this view; they do not change the school page.</small>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
