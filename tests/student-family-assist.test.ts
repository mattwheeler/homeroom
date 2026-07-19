import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudentFamilyAssist } from "../app/components/student-family-assist";

const candidate = {
  id: "guardian:google_classroom:coursework:physical_form",
  taskId: "google_classroom:coursework:physical_form",
  title: "Band physical form",
  courseName: "Concert Band - Period 6",
  due: { date: "2026-07-24", time: "17:00:00" },
  reason: "The source says a parent or guardian must complete this item.",
  source: {
    provider: "google_classroom" as const,
    recordType: "coursework" as const,
    externalId: "physical_form",
    sourceUpdatedAt: "2026-07-19T14:00:00.000Z"
  }
};

describe("student-controlled family help", () => {
  it("keeps the action collapsed and promises an exact preview before sending", () => {
    const html = renderToStaticMarkup(createElement(StudentFamilyAssist, { csrfToken: "csrf", candidate }));

    expect(html).toContain("Something Matt may need to handle");
    expect(html).toContain("Homeroom noticed a guardian-only step");
    expect(html).toContain("Ask Matt about this");
    expect(html).not.toContain("Approve and notify Matt");
  });

  it("renders nothing when no connected source supports a guardian step", () => {
    const html = renderToStaticMarkup(createElement(StudentFamilyAssist, { csrfToken: "csrf", candidate: null }));
    expect(html).toBe("");
  });
});
