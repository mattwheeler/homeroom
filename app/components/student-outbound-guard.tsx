import type { StudentExternalLinkPolicy } from "../../lib/domain/student-external-links";

import styles from "./student-outbound-guard.module.css";

export function StudentOutboundGuard({
  policy,
  resourceLabel
}: {
  policy?: StudentExternalLinkPolicy;
  resourceLabel: string;
}) {
  if (policy === "guardian_approval") {
    return (
      <span className={styles.guard} role="status" data-student-outbound="guardian-approval">
        <strong>Ask your guardian to open</strong>
        <small>The {resourceLabel} stays protected; Homeroom does not send you directly outside the app.</small>
      </span>
    );
  }
  return (
    <span className={styles.guard} role="status" data-student-outbound="blocked">
      <strong>External links are blocked</strong>
      <small>Your guardian has turned off outside links for this student account.</small>
    </span>
  );
}
