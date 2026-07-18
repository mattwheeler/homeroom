import { expect, test } from "@playwright/test";

const plan = {
  title: "Your band-camp morning",
  intro: "A calm start with enough time for the essentials.",
  steps: [
    { time: "06:30", title: "Wake up", detail: "Get dressed and have breakfast.", sourceLabel: "Homeroom plan" },
    { time: "06:45", title: "Final bag check", detail: "Bring your instrument, water, and music folder.", sourceLabel: "Band packing list" },
    { time: "07:00", title: "Leave home", detail: "Allow 20 minutes for travel and a 10-minute buffer.", sourceLabel: "Band calendar + preferences" },
    { time: "07:30", title: "Check in", detail: "You will be ready before the 8:00 AM start.", sourceLabel: "Band calendar" }
  ],
  guardianNote: "Matt owns the band physical form due July 24.",
  encouragement: "You have a clear plan—and you do not have to remember everything at once.",
  approvalPrompt: "Review this proposal. Would you like to adjust anything before saving it?"
};

const revision = {
  change: {
    title: "Your BAND check-in moved 15 minutes earlier",
    summary: "Check-in changed from 7:30 AM to 7:15 AM, so the morning steps move 15 minutes earlier.",
    changedField: "checkIn",
    before: "07:30",
    after: "07:15",
    minutesEarlier: 15,
    sourceLabel: "BAND calendar · event_band_camp_day_1"
  },
  plan: {
    ...plan,
    title: "Updated band-camp morning",
    intro: "The same calm routine, shifted 15 minutes earlier.",
    steps: plan.steps.map((step, index) => ({
      ...step,
      time: ["06:15", "06:30", "06:45", "07:15"][index]
    })),
    approvalPrompt: "Review the updated times before saving Plan V2."
  }
};

test("Emily saves Plan V1, reviews a BAND source change, and explicitly saves Plan V2", async ({ page }) => {
  await page.route("**/api/demo-sessions", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "session_01",
        csrfToken: "csrf-test",
        profile: { name: "Emily", grade: 9 }
      })
    });
  });
  await page.route("**/api/morning-plan", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan,
        approval: {
          actionId: "action_123456789012345678901234",
          receipt: "receipt-value-long-enough",
          expiresAt: "2026-07-18T12:10:00.000Z",
          planVersion: 1,
          stateVersion: 6
        },
        proof: {
          model: "gpt-5.6-sol-2026-07-15",
          responseIds: ["resp_context", "resp_plan"],
          tools: ["get_morning_plan_context"],
          sourceVersion: 1
        }
      })
    });
  });
  await page.route("**/api/morning-plan/approve", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    expect(route.request().postDataJSON()).toEqual({
      actionId: "action_123456789012345678901234",
      receipt: "receipt-value-long-enough"
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        saved: true,
        planVersion: 1,
        phase: "PLAN_V1_SAVED",
        savedAt: "2026-07-18T12:06:00.000Z",
        proof: {
          approvalId: "action_123456789012345678901234",
          argsHash: "a".repeat(64),
          sourceVersion: 1,
          stateVersion: 7
        }
      })
    });
  });
  await page.route("**/api/plan-update", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision,
        approval: {
          actionId: "action_222222222222222222222222",
          receipt: "receipt-v2-value-long-enough",
          expiresAt: "2026-07-18T12:13:00.000Z",
          planVersion: 2,
          stateVersion: 9
        },
        proof: {
          model: "gpt-5.6-sol-2026-07-15",
          responseIds: ["resp_revision_context", "resp_revision"],
          tools: ["get_plan_revision_context"],
          sourceVersion: 2,
          previousPlanVersion: 1
        }
      })
    });
  });
  await page.route("**/api/plan-update/approve", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      actionId: "action_222222222222222222222222",
      receipt: "receipt-v2-value-long-enough"
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        saved: true,
        planVersion: 2,
        phase: "PLAN_V2_SAVED",
        savedAt: "2026-07-18T12:09:00.000Z",
        proof: {
          approvalId: "action_222222222222222222222222",
          argsHash: "b".repeat(64),
          sourceVersion: 2,
          stateVersion: 10
        }
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Start my day" }).click();
  await page.getByRole("button", { name: "Build my morning plan" }).click();

  await expect(page.getByRole("heading", { name: plan.title })).toBeVisible();
  await expect(page.locator("time").getByText("06:30", { exact: true })).toBeVisible();
  await expect(page.locator("time").getByText("07:30", { exact: true })).toBeVisible();
  await expect(page.getByText(plan.guardianNote)).toBeVisible();
  await expect(page.getByText("Live GPT-5.6 Sol")).toBeVisible();
  await expect(page.getByText("Nothing has been saved yet")).toBeVisible();
  await page.getByRole("button", { name: "Approve and save Plan V1" }).click();
  await expect(page.getByText("Plan V1 saved")).toBeVisible();
  await expect(page.getByText("Saved by Emily · Source version 1")).toBeVisible();
  await page.getByRole("button", { name: "Check BAND for updates" }).click();
  await expect(page.getByRole("heading", { name: revision.change.title })).toBeVisible();
  await expect(page.locator(".time-diff").getByText("7:30 AM", { exact: true })).toBeVisible();
  await expect(page.locator(".time-diff").getByText("7:15 AM", { exact: true })).toBeVisible();
  await expect(page.getByText("FROM BAND CALENDAR · SOURCE V2", { exact: true })).toBeVisible();
  await expect(page.locator(".time-track").getByText("7:15 AM", { exact: true })).toBeVisible();
  await expect(page.getByText("Plan V1 is still active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve and save Plan V2" }).click();
  await expect(page.getByText("Plan V2 saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved by Emily · Source version 2", { exact: true })).toBeVisible();
});
