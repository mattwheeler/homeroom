import { expect, test } from "@playwright/test";

import { navigationProjection } from "../tests/student-navigation-fixture";

const projection = structuredClone(navigationProjection);
projection.priorities[0] = {
  ...projection.priorities[0],
  id: "google_classroom:coursework:work_band",
  title: "Band Camp Packing Checklist",
  directions: "Confirm your instrument, music binder, water bottle, sunscreen, hat, lunch, and athletic shoes are ready.",
  sessionPlan: { kind: "checklist_preparation", maxSteps: 4 },
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
    lastSyncAt: "2026-08-16T12:00:00.000Z",
    lastErrorCode: null
  },
  {
    id: "school_supplies_student_emily_algebra",
    provider: "school_supplies",
    status: "active",
    displayName: "Pieper High School Algebra I supplies",
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
  id: "school_supplies:0",
  title: "Algebra I Supply List",
  sourceTitle: "Algebra I Supply List",
  outbound: { available: true, policy: "guardian_approval" },
  source: { provider: "school_supplies", recordType: "supply_list", externalId: "school_supplies:0", sourceUpdatedAt: null },
  items: [
    { id: "supply_notebook", text: "1 composition notebook", quantity: null, sourceOrdinal: 1, kind: "item" },
    { id: "supply_pencils", text: "Pencils", quantity: null, sourceOrdinal: 2, kind: "item" }
  ]
}];

test("Emily can use the complete calm student journey", async ({ page }) => {
  let checkInTurn = 0;
  await page.route("**/api/student/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        csrfToken: "csrf-student-e2e",
        profile: { name: "Emily", grade: 9 },
        session: { reused: false, expiresAt: "2026-08-17T16:00:00.000Z" },
        projection
      })
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
      focusBlock: {
        id: "focus_01",
        studentId: "student_emily",
        sessionId: "session_e2e",
        taskId: projection.priorities[0].id,
        taskTitle: projection.priorities[0].title,
        courseName: projection.priorities[0].course.name,
        sourceProvider: "google_classroom",
        sourceExternalId: projection.priorities[0].source.externalId,
        estimatedMinutes: 20,
        selectedMinutes: body.selectedMinutes,
        elapsedSeconds: body.elapsedSeconds,
        completedChunkIds: body.completedChunkIds,
        completedChunkCount: body.completedChunkIds.length,
        plannedChunkCount: 4,
        taskKind: "checklist_preparation",
        sourceStatus: "Not submitted",
        completedAt: "2026-08-17T15:00:00.000Z"
      },
      reentry: { active: false, title: "", message: "", missedDayCount: 0 }
    }) });
  });
  await page.route("**/api/student/check-in", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-student-e2e");
    const body = route.request().postDataJSON();
    if (checkInTurn === 0) {
      expect(body).toEqual({
        focusState: null,
        message: "I know what to do, but I cannot get started.",
        history: []
      });
    } else {
      expect(body).toEqual({
        focusState: null,
        message: "Choosing one packing item sounds easier.",
        history: [
          { role: "student", text: "I know what to do, but I cannot get started." },
          { role: "homeroom", text: "You know the task; the hard part is crossing the starting line. Would a two-minute timer or choosing one packing item feel easier?" }
        ]
      });
    }
    checkInTurn += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: {
          message: checkInTurn === 1
            ? "You know the task; the hard part is crossing the starting line."
            : "Good choice. Put the instrument by the door; that is enough for this step.",
          followUpQuestion: checkInTurn === 1
            ? "Would a two-minute timer or choosing one packing item feel easier?"
            : "Want to choose the next tiny item together?",
          suggestedAction: "none"
        },
        proof: { mode: "live", model: "gpt-5.6-sol", responseId: "resp_checkin_e2e" }
      })
    });
  });
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/student");

  await expect(page.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Emily\./ })).toBeVisible();
  await expect(page.getByText("Assignments and dates checked")).toBeVisible();
  const unifiedWorkspace = page.getByTestId("today-unified-workspace");
  const workspaceBox = await unifiedWorkspace.boundingBox();
  expect(workspaceBox?.width).toBeGreaterThan(1000);
  const coachingBox = await page.getByTestId("today-coaching-panel").boundingBox();
  const primaryBox = await page.getByTestId("today-primary-column").boundingBox();
  expect(coachingBox).not.toBeNull();
  expect(primaryBox).not.toBeNull();
  expect(coachingBox!.y + coachingBox!.height).toBeLessThan(primaryBox!.y);
  expect(primaryBox!.y + primaryBox!.height).toBeLessThanOrEqual(1200);
  await expect(page.getByRole("button", { name: "Something else…" })).toBeVisible();
  await expect(page.getByLabel("What would you like help with right now?")).toBeHidden();
  for (const region of [page.getByTestId("today-primary-column"), page.getByTestId("today-coaching-panel")]) {
    const dimensions = await region.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY
    }));
    expect(dimensions.overflowY).not.toMatch(/auto|scroll/);
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
  }
  await page.getByRole("button", { name: "Low energy" }).click();
  await expect(page.getByLabel("What would you like help with right now?")).toHaveValue("I have low energy today, and it is affecting my ability to focus.");
  await page.getByRole("button", { name: "Low energy" }).click();
  await expect(page.getByLabel("What would you like help with right now?")).toHaveValue("");
  await page.getByLabel("What would you like help with right now?").fill("I know what to do, but I cannot get started.");
  await page.getByRole("button", { name: "Talk to Homeroom" }).click();
  await expect(page.getByText("You know the task; the hard part is crossing the starting line.")).toBeVisible();
  await expect(page.getByText("Would a two-minute timer or choosing one packing item feel easier?")).toBeVisible();
  await page.getByLabel("What would you like help with right now?").fill("Choosing one packing item sounds easier.");
  await page.getByRole("button", { name: "Talk to Homeroom" }).click();
  await expect(page.getByText("Good choice. Put the instrument by the door; that is enough for this step.")).toBeVisible();
  await expect(page.getByText("Want to choose the next tiny item together?")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Band Camp Packing Checklist" })).toBeVisible();

  await page.getByRole("button", { name: "Start this assignment" }).click();
  await expect(page.getByRole("dialog", { name: "Band Camp Packing Checklist" })).toBeVisible();
  const taskRoom = page.getByRole("dialog", { name: "Band Camp Packing Checklist" });
  await expect(page.getByRole("heading", { name: "Check the list" })).toBeVisible();
  await expect(page.getByText("My private work", { exact: true })).toBeVisible();
  const plan = taskRoom.locator("details").filter({ hasText: "See the full plan" });
  await page.getByText("See the full plan", { exact: true }).click();
  await expect(plan).toHaveAttribute("open", "");
  await expect(plan.getByText("Check the list", { exact: true })).toBeVisible();
  await page.getByText("Assignment details", { exact: true }).click();
  await expect(page.getByText("Homeroom never submits or changes this assignment.")).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 900 });
  const railBox = await taskRoom.getByTestId("task-room-focus-rail").boundingBox();
  const workBox = await taskRoom.getByTestId("task-room-work-area").boundingBox();
  expect(railBox).not.toBeNull();
  expect(workBox).not.toBeNull();
  expect(railBox!.x).toBeGreaterThan(workBox!.x + workBox!.width);
  await expect(plan.getByRole("checkbox")).toHaveCount(4);
  for (const checkbox of await plan.getByRole("checkbox").all()) await checkbox.check();
  await taskRoom.getByRole("button", { name: "Save finished session" }).click();
  await expect(taskRoom.getByText("FOCUS SESSION SAVED", { exact: true })).toBeVisible();
  await expect(taskRoom.getByText(/does not mark the assignment complete/)).toBeVisible();
  await taskRoom.getByRole("button", { name: "Return to Today" }).click();
  await expect(page.getByText(/Focus block saved in Homeroom/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your last focus session" })).toBeVisible();
  const recentWork = page.getByRole("region", { name: "Your last focus session" });
  await expect(recentWork.getByText("Band Camp Packing Checklist")).toBeVisible();
  await expect(recentWork.getByText(/4 of 4 steps/)).toBeVisible();
  await expect(recentWork.getByRole("button", { name: "Work on it again" })).toBeVisible();

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
  await expect(page.getByText("Every line below comes from a page your guardian connected.", { exact: true })).toBeVisible();

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
