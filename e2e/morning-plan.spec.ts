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

test("Emily builds a live, source-grounded morning-plan proposal", async ({ page }) => {
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
        proof: {
          model: "gpt-5.6-sol-2026-07-15",
          responseIds: ["resp_context", "resp_plan"],
          tools: ["get_morning_plan_context"],
          sourceVersion: 1
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
});
