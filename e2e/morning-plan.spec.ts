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

test("Emily saves both plans and completes a hint-led Algebra refresher", async ({ page }) => {
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
  await page.route("**/api/practice/start", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        exercise: { id: "linear_equation_01", course: "Algebra I", prompt: "3(x + 2) = 18" },
        hint: {
          title: "Undo one layer",
          encouragement: "You only need to choose the first move.",
          question: "Which operation would undo the multiplication wrapped around the parentheses?",
          concept: "inverse operations",
          answerPolicy: "hidden"
        },
        progress: { hintsUsed: 1, attempts: 0, stateVersion: 11 },
        proof: {
          model: "gpt-5.6-sol-2026-07-15",
          responseIds: ["resp_exercise", "resp_hint"],
          tools: ["get_practice_exercise"],
          exerciseId: "linear_equation_01"
        }
      })
    });
  });
  let practiceAttempt = 0;
  await page.route("**/api/practice/attempt", async (route) => {
    practiceAttempt += 1;
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    if (practiceAttempt === 1) {
      expect(route.request().postDataJSON()).toEqual({
        kind: "first_step", answer: "divide_both_sides_by_3"
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          correct: true,
          completed: false,
          equation: "x + 2 = 6",
          feedback: "Exactly. You used the inverse operation on both sides.",
          next: { kind: "final_answer", prompt: "What operation undoes +2? What is x?" },
          proof: { grader: "homeroom-deterministic-v1", attempts: 1, stateVersion: 11 }
        })
      });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({ kind: "final_answer", answer: "4" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        correct: true,
        completed: true,
        answer: "x = 4",
        celebration: "You solved it one step at a time.",
        proof: {
          grader: "homeroom-deterministic-v1",
          exerciseId: "linear_equation_01",
          hintsUsed: 1,
          attempts: 2,
          stateVersion: 12,
          completedAt: "2026-07-18T12:12:00.000Z"
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
  await page.getByRole("button", { name: "Start Algebra refresher" }).click();
  await expect(page.getByRole("heading", { name: "Undo one layer" })).toBeVisible();
  await expect(page.getByText("Live GPT-5.6 Sol hint", { exact: true })).toBeVisible();
  await expect(page.getByText("Answer hidden until you solve it", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Divide both sides by 3" }).click();
  await expect(page.getByText("x + 2 = 6", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "What is x?" }).fill("4");
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText("Practice complete", { exact: true })).toBeVisible();
  await expect(page.getByText("You solved it one step at a time.", { exact: true })).toBeVisible();
  await expect(page.getByText("Deterministically graded · 2 attempts · 1 hint", { exact: true })).toBeVisible();
});
