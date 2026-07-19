import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DigestDeliveryNotice,
  GuardianInbox,
  digestDeliveryConfirmation
} from "../app/components/guardian-inbox";
import {
  guardianNavigationItems,
  guardianSectionFromHash,
  nextGuardianNavigationIndex,
  sourceTypePresentation
} from "../app/components/guardian-workspace-model";
import {
  buildGuardianWorkspace,
  defaultGuardianSetupSettings
} from "../lib/domain/guardian-setup-profile";

describe("guardian workspace navigation", () => {
  it("prioritizes the five working destinations and resolves deep links", () => {
    expect(guardianNavigationItems.map((item) => [item.label, item.href])).toEqual([
      ["Inbox", "#guardian-inbox"],
      ["Household & student", "#household"],
      ["Learning", "#learning-support"],
      ["Safety", "#safety-privacy"],
      ["Sources", "#school-sources"]
    ]);
    expect(guardianSectionFromHash("#safety-privacy")).toBe("safety-privacy");
    expect(guardianSectionFromHash("#student-profile")).toBe("household");
    expect(guardianSectionFromHash("#not-a-section")).toBe("guardian-inbox");
  });

  it("supports arrow, home, and end keyboard movement without trapping other keys", () => {
    expect(nextGuardianNavigationIndex(0, "ArrowDown")).toBe(1);
    expect(nextGuardianNavigationIndex(0, "ArrowUp")).toBe(4);
    expect(nextGuardianNavigationIndex(2, "Home")).toBe(0);
    expect(nextGuardianNavigationIndex(2, "End")).toBe(4);
    expect(nextGuardianNavigationIndex(2, "Tab")).toBeNull();
  });
});

describe("guardian household and source truth", () => {
  it("uses family-neutral source labels until this household connects an example", () => {
    const workspace = buildGuardianWorkspace({
      settings: defaultGuardianSetupSettings(),
      settingsVersion: 1,
      updatedAt: null
    }, []);

    expect(workspace.sources.map((source) => source.label)).toEqual([
      "Google Classroom",
      "Private calendar feed",
      "Official school or district calendar",
      "Official school or course supply list"
    ]);
    expect(workspace.guardian).toMatchObject({ name: "Matt", relationship: "Parent" });
    expect(workspace.student).toMatchObject({ name: "Emily", age: 14, grade: 9 });
  });

  it("explains each supported source type and the connector currently available", () => {
    expect(sourceTypePresentation("google_classroom")).toMatchObject({
      typeLabel: "Learning platform",
      connectorLabel: "Google Classroom"
    });
    expect(sourceTypePresentation("band_ical")).toMatchObject({
      typeLabel: "Calendar feed",
      connectorLabel: "Private iCalendar link"
    });
    expect(sourceTypePresentation("school_calendar").limitation).toContain("Comal ISD");
    expect(sourceTypePresentation("school_supplies").typeLabel).toBe("Official supply list");
  });
});

describe("guardian digest delivery confirmation", () => {
  it("disables email controls while the authenticated recipient and inbox are loading", () => {
    const markup = renderToStaticMarkup(createElement(GuardianInbox, { csrfToken: "csrf_test" }));

    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toContain("Loading family notes…");
    expect(markup.match(/disabled=\"\"/g)).toHaveLength(2);
  });

  it("keeps the recipient and delivery time in both success and failure receipts", () => {
    const success = digestDeliveryConfirmation({
      kind: "success",
      recipientEmail: "matt@example.com",
      occurredAt: "2026-07-19T14:30:00.000Z"
    });
    const failure = digestDeliveryConfirmation({
      kind: "failure",
      recipientEmail: "matt@example.com",
      occurredAt: "2026-07-19T14:31:00.000Z",
      error: "Email delivery is not configured."
    });

    expect(success).toMatchObject({
      title: "Email digest sent",
      recipient: "matt@example.com",
      occurredAt: "2026-07-19T14:30:00.000Z"
    });
    expect(failure).toMatchObject({
      title: "Email digest not sent",
      recipient: "matt@example.com",
      occurredAt: "2026-07-19T14:31:00.000Z"
    });
    expect(failure.detail).toContain("Email delivery is not configured.");
  });

  it("renders a prominent accessible receipt with recipient and machine-readable time", () => {
    const markup = renderToStaticMarkup(createElement(DigestDeliveryNotice, {
      delivery: {
        kind: "success",
        recipientEmail: "matt@example.com",
        occurredAt: "2026-07-19T14:30:00.000Z"
      }
    }));

    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("Email digest sent");
    expect(markup).toContain("matt@example.com");
    expect(markup).toContain("dateTime=\"2026-07-19T14:30:00.000Z\"");
  });
});
