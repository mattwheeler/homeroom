import { expect, test } from "@playwright/test";

import { navigationProjection } from "../tests/student-navigation-fixture";

const projection = structuredClone(navigationProjection);
projection.priorities[0] = {
  ...projection.priorities[0],
  id: "google_classroom:coursework:work_band",
  title: "Band Camp Packing Checklist",
  course: {
    externalId: "google_band",
    name: "Concert Band - Period 6",
    trackCourseId: "course_band"
  },
  source: {
    provider: "google_classroom",
    recordType: "coursework",
    externalId: "work_band",
    sourceUpdatedAt: "2026-08-16T12:00:00.000Z"
  }
};
projection.learningRecommendations = [
  ["course_band", "Concert Band - Period 6", "readiness_band_count_01", "Count the pulse"],
  ["course_algebra_1", "Algebra I - Period 2", "readiness_algebra_balance_01", "Equations stay balanced"],
  ["course_english_1", "English I - Period 1", "readiness_english_claims_01", "Claims need evidence"]
].map(([courseId, courseName, missionId, missionTitle]) => ({
  id: `learning:${missionId}`,
  courseId: courseId as "course_band" | "course_algebra_1" | "course_english_1",
  courseName,
  missionId,
  missionTitle,
  objective: "Practice one useful readiness skill.",
  suggestedMinutes: 10,
  supportPreference: "example_first",
  rationale: "Prepare a skill connected to upcoming work.",
  visual: {
    format: "worked_example_then_steps",
    stepCount: 3,
    progressStyle: "visible_timebox_and_steps"
  },
  evidence: []
}));
projection.sourceSummary.schoolConnections = [
  {
    id: "school_calendar_student_emily",
    provider: "school_calendar",
    status: "active",
    displayName: "Comal ISD official calendar",
    sourceUrl: "https://www.comalisd.org/apps/pages/calendars",
    lastSyncAt: "2026-08-16T12:00:00.000Z",
    lastErrorCode: null
  },
  {
    id: "school_supplies_student_emily_algebra",
    provider: "school_supplies",
    status: "active",
    displayName: "Pieper High School Algebra I supplies",
    sourceUrl: "https://phs.comalisd.org/apps/pages/index.jsp?pREC_ID=2692760&type=u&uREC_ID=2803759",
    lastSyncAt: "2026-08-16T12:00:00.000Z",
    lastErrorCode: null
  }
];
projection.calendar?.items.push({
  id: "school_calendar:event:first_day:calendar",
  kind: "event",
  title: "First day of school",
  date: "2026-08-17",
  timeLabel: "All day",
  startsAt: "2026-08-17T05:00:00.000Z",
  endsAt: "2026-08-18T05:00:00.000Z",
  courseExternalId: null,
  courseName: null,
  statusLabel: "School day",
  visualToken: "blue",
  category: "school",
  source: {
    provider: "school_calendar",
    recordType: "calendar_event",
    externalId: "first_day",
    sourceUpdatedAt: "2026-03-02T20:56:59.000Z"
  }
});
projection.supplies = [{
  provider: "school_supplies",
  title: "Algebra I Supply List",
  sourceUrl: "https://phs.comalisd.org/apps/pages/index.jsp?pREC_ID=2692760&type=u&uREC_ID=2803759",
  sourceTitle: "Algebra I Supply List",
  items: [
    { id: "supply_notebook", text: "1 composition notebook", quantity: null, sourceOrdinal: 1, kind: "item" },
    { id: "supply_pencils", text: "Pencils", quantity: null, sourceOrdinal: 2, kind: "item" }
  ]
}];

test("Emily can use the complete calm student journey", async ({ page }) => {
  await page.route("**/api/sessions", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "session_student_e2e",
        csrfToken: "csrf-student-e2e",
        profile: { name: "Emily", grade: 9 }
      })
    });
  });
  await page.route("**/api/student/projection", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-student-e2e");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projection)
    });
  });
  await page.route("**/api/focus-blocks", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "list") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        focusBlocks: [], reentry: { active: false, title: "", message: "", missedDayCount: 0 }
      }) });
      return;
    }
    expect(body.action).toBe("complete");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      focusBlock: { id: "focus_01", completedAt: "2026-08-16T13:00:00.000Z" },
      reentry: { active: false, title: "", message: "", missedDayCount: 0 }
    }) });
  });
  await page.goto("/student");

  await expect(page.getByRole("heading", { name: "Hi Emily." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Grade 9 summer readiness is ready." })).toBeVisible();
  await expect(page.getByText("Real class names appear only after a school source sync", { exact: false })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Show me my first step" }).click();
  await expect(page.getByRole("heading", { name: /One thing at a time|You’re caught up/ })).toBeVisible();
  await expect(page.getByText("You do not need to hold the whole day in your head.")).toBeVisible();

  await page.getByRole("button", { name: "Start this assignment" }).click();
  await expect(page.getByRole("dialog", { name: "Band Camp Packing Checklist" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your 3-step checklist" })).toBeVisible();
  await expect(page.getByText("Homeroom never submits or changes this assignment.")).toBeVisible();
  const taskRoom = page.getByRole("dialog", { name: "Band Camp Packing Checklist" });
  await expect(taskRoom.getByRole("checkbox")).toHaveCount(3);
  for (const checkbox of await taskRoom.getByRole("checkbox").all()) await checkbox.check();
  await taskRoom.getByRole("button", { name: "Finish focus block" }).click();
  await expect(taskRoom.getByText("FOCUS BLOCK COMPLETE", { exact: true })).toBeVisible();
  await taskRoom.getByRole("button", { name: "Return to Today" }).click();
  await expect(page.getByText(/Focus block saved in Homeroom/)).toBeVisible();

  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { name: "See the month. Focus on one date." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
  await expect(page.getByText("Pieper / Comal ISD official calendar")).toBeVisible();

  await page.getByRole("tab", { name: "Classes" }).click();
  await expect(page.getByRole("heading", { name: "All 7 connected classes." })).toBeVisible();
  await expect(page.locator("[data-class-card]")).toHaveCount(7);
  await expect(page.getByText(/Google Classroom/).first()).toBeVisible();

  await page.getByRole("tab", { name: "Supplies" }).click();
  await expect(page.getByRole("heading", { name: "Know what you need. Check what you have." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Algebra I Supply List" })).toBeVisible();
  await expect(page.getByText("Homeroom did not add or guess any item.", { exact: false })).toBeVisible();

  await page.getByRole("tab", { name: "Learn" }).click();
  await expect(page.getByRole("heading", { name: "Pick one short practice room" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open .* learning track/ })).toHaveCount(3);

  await page.getByRole("tab", { name: "Today" }).click();
  await page.getByRole("button", { name: "Build today’s live plan" }).click();
  await expect(page.getByRole("dialog", { name: "Build a routine from today’s real sources" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan one school day." })).toBeVisible();
  await page.getByRole("button", { name: "Back to Today" }).click();

  await expect(page.getByText("Guardian", { exact: true })).toHaveCount(0);
});
