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

test("Emily completes the Golden privacy and guardian-sharing journey", async ({ page }) => {
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
  await page.route("**/api/family/reminder/preview", async (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      preview: { title: "Band physical form needs your help", message: "Emily needs your help completing the band physical form by Friday, July 24.", task: { label: "Complete the band physical form", dueAt: "2026-07-24T17:00:00-05:00" }, recipient: { name: "Matt" } },
      approval: { actionId: "action_444444444444444444444444", receipt: "family-reminder-receipt-long", expiresAt: "2026-07-18T12:06:00.000Z" },
      proof: { independentTrack: "family", stateUnchanged: true, stateVersion: 5 }
    }) });
  });
  await page.route("**/api/family/reminder/send", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ actionId: "action_444444444444444444444444", receipt: "family-reminder-receipt-long" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: true, notificationId: "notification_01", recipient: "Matt", channel: "Homeroom guardian inbox", sentAt: "2026-07-18T12:02:00.000Z", reminder: {}, proof: { approvalId: "action_444444444444444444444444", argsHash: "f".repeat(64), stateVersion: 5 } }) });
  });
  await page.route("**/api/learning/context", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ courseId: "course_algebra_1" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        signals: [],
        progress: [],
        policy: {
          rawCompletedDialogueRetained: false,
          memoryIsVisibleAndDeletable: true,
          crossCourseContext: false
        }
      })
    });
  });
  await page.route("**/api/learning/start", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    expect(route.request().postDataJSON()).toEqual({
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first"
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        learningSession: {
          id: "learning_123456789012345678901234",
          courseId: "course_algebra_1",
          durationMinutes: 10,
          targetEndsAt: "2099-07-18T12:10:00.000Z",
          turnCount: 0,
          status: "active"
        },
        track: {
          courseId: "course_algebra_1",
          courseName: "Algebra I",
          trackTitle: "Starting Strong in Algebra I",
          coachMode: "guided_problem_solving",
          mission: {
            id: "readiness_algebra_balance_01",
            title: "Equations stay balanced",
            objectiveId: "algebra_equation_balance",
            objective: "Explain why the same operation must be applied to both sides of an equation.",
            activityBoundary: "Use original examples.",
            suggestedMinutes: 10,
            source: { kind: "homeroom_readiness", label: "Homeroom readiness mission", version: 1 }
          }
        },
        turn: {
          phase: "check_in",
          message: "We’ll use one quick example, then you’ll take the lead.",
          question: "When an equation changes on one side, what must happen on the other side?",
          encouragement: "This is a starting point, not a grade.",
          answerPolicy: "coach_not_complete"
        },
        timing: { targetEndsAt: "2099-07-18T12:10:00.000Z", remainingSeconds: 590, phase: "check_in" },
        learnerContext: [],
        proof: { independentTrack: "learning", goldenStateUnchanged: true, store: false }
      })
    });
  });
  await page.route("**/api/learning/turn", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      learningSessionId: "learning_123456789012345678901234",
      response: "Both sides have to stay equal."
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        learningSessionId: "learning_123456789012345678901234",
        turnCount: 1,
        turn: {
          phase: "diagnostic",
          message: "Exactly—the equality has to remain true.",
          question: "If we subtract 3 from the left side, what should we do to the right side?",
          encouragement: "You identified the central idea.",
          answerPolicy: "coach_not_complete"
        },
        timing: { targetEndsAt: "2099-07-18T12:10:00.000Z", remainingSeconds: 540, phase: "diagnostic" },
        memoryUsed: [],
        proof: { model: "gpt-5.6-sol-2026-07-15", store: false }
      })
    });
  });
  await page.route("**/api/learning/complete", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      learningSessionId: "learning_123456789012345678901234"
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        completed: true,
        learningSessionId: "learning_123456789012345678901234",
        summary: {
          courseName: "Algebra I",
          missionTitle: "Equations stay balanced",
          objective: "Explain why the same operation must be applied to both sides of an equation.",
          objectiveStatus: "exploring",
          completedTurns: 1,
          sourceLabel: "Homeroom readiness mission",
          memoryStatement: "One worked example before independent practice."
        },
        memory: {
          id: "signal_abcdefabcdefabcdefabcdef",
          statement: "One worked example before independent practice.",
          why: "Emily selected this support preference when the session began.",
          canDelete: true
        },
        progress: { status: "exploring", sessionsCompleted: 1 },
        proof: { activeDialogueDeleted: true, goldenStateUnchanged: true, goldenStateVersion: 5 }
      })
    });
  });
  await page.route("**/api/learning/context/delete", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      signalId: "signal_abcdefabcdefabcdefabcdef"
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ deleted: true })
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
  const guardianProjection = {
    projectionVersion: 1,
    recipient: { id: "guardian_matt", name: "Matt", relationship: "Parent" },
    student: { id: "student_emily", name: "Emily", grade: 9 },
    headline: "Emily is on track for band camp.",
    shared: {
      bandCamp: { date: "2026-08-03", checkIn: "07:15", start: "08:00" },
      morningPlan: { planVersion: 2, wake: "06:15", leave: "06:45", status: "saved" },
      practice: { course: "Algebra I", status: "completed", summary: "One summer refresher completed." },
      guardianTask: {
        label: "Complete the band physical form",
        dueAt: "2026-07-24T17:00:00-05:00",
        status: "needs_guardian"
      }
    },
    privacy: {
      excluded: ["Algebra answer", "step-by-step work", "attempt count", "hint count", "private coaching"]
    },
    generatedAt: "2026-07-18T12:13:00.000Z"
  };
  await page.route("**/api/guardian/preview", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preview: guardianProjection,
        approval: {
          actionId: "action_333333333333333333333333",
          receipt: "guardian-receipt-value-long-enough",
          expiresAt: "2026-07-18T12:18:00.000Z",
          projectionVersion: 1,
          stateVersion: 13
        },
        proof: {
          projectionHash: "c".repeat(64),
          sourceVersion: 2,
          activePlanVersion: 2,
          privateFieldCount: 5
        }
      })
    });
  });
  await page.route("**/api/guardian/publish", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    expect(route.request().postDataJSON()).toEqual({
      actionId: "action_333333333333333333333333",
      receipt: "guardian-receipt-value-long-enough"
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        published: true,
        projectionVersion: 1,
        phase: "GUARDIAN_PUBLISHED",
        publishedAt: "2026-07-18T12:14:00.000Z",
        recipient: "Matt",
        view: guardianProjection,
        proof: {
          approvalId: "action_333333333333333333333333",
          argsHash: "d".repeat(64),
          projectionHash: "c".repeat(64),
          stateVersion: 14
        }
      })
    });
  });
  const proofView = {
    contractVersion: 1,
    headline: "Golden Experience verified",
    session: {
      id: "session_01", student: "Emily", fixture: "Fictional Build Week data",
      phase: "COMPLETE", stateVersion: 15, sourceVersion: 2, activePlanVersion: 2
    },
    scorecard: {
      liveModelTurns: 3, auditedTransitions: 6, approvedWrites: 3, privateLearningDetailsExposed: 0
    },
    sources: [
      { name: "BAND calendar", recordId: "event_band_camp_day_1", version: 2, status: "verified" },
      { name: "Band packing list", recordId: "material_band_camp_packing", version: 1, status: "verified" },
      { name: "Algebra I practice", recordId: "linear_equation_01", version: 1, status: "verified" },
      { name: "Guardian task", recordId: "guardian_action_physical_form", version: 1, status: "verified" }
    ],
    timeline: [
      { sequence: 1, label: "Emily approved Plan V1", actor: "Emily", stateVersion: 7, createdAt: "2026-07-18T12:06:00.000Z", proof: "Receipt-bound approval · args aaaaaaaa…" },
      { sequence: 2, label: "BAND source advanced to V2", actor: "BAND fixture", stateVersion: 8, createdAt: "2026-07-18T12:07:00.000Z", proof: "Controlled source transition" },
      { sequence: 3, label: "Emily approved Plan V2", actor: "Emily", stateVersion: 10, createdAt: "2026-07-18T12:09:00.000Z", proof: "Receipt-bound approval · args bbbbbbbb…" },
      { sequence: 4, label: "Algebra practice completed", actor: "Emily", stateVersion: 12, createdAt: "2026-07-18T12:12:00.000Z", proof: "Deterministic grader · private work excluded" },
      { sequence: 5, label: "Guardian-safe view published", actor: "Emily", stateVersion: 14, createdAt: "2026-07-18T12:14:00.000Z", proof: "Projection dddddddd… · 5 private fields excluded" },
      { sequence: 6, label: "Judge proof opened", actor: "Emily", stateVersion: 15, createdAt: "2026-07-18T12:15:00.000Z", proof: "Read-only evidence view" }
    ],
    aiTurns: [
      { stage: "morning_plan", label: "Morning plan", model: "gpt-5.6-sol-2026-07-15", status: "completed", responseIds: ["resp_plan_1", "resp_plan_2"], tools: ["get_morning_plan_context"], latencyMs: 8100, usage: { inputTokens: 900, outputTokens: 180, cachedTokens: 100 }, createdAt: "2026-07-18T12:05:00.000Z" },
      { stage: "plan_revision", label: "Source-change revision", model: "gpt-5.6-sol-2026-07-15", status: "completed", responseIds: ["resp_revision_1", "resp_revision_2"], tools: ["get_plan_revision_context"], latencyMs: 7600, usage: { inputTokens: 820, outputTokens: 165, cachedTokens: 80 }, createdAt: "2026-07-18T12:08:00.000Z" },
      { stage: "learning_hint", label: "Socratic Algebra hint", model: "gpt-5.6-sol-2026-07-15", status: "completed", responseIds: ["resp_hint_1", "resp_hint_2"], tools: ["get_practice_exercise"], latencyMs: 3900, usage: { inputTokens: 610, outputTokens: 95, cachedTokens: 40 }, createdAt: "2026-07-18T12:10:00.000Z" }
    ],
    privacy: {
      keptPrivate: ["answers", "step-by-step work", "attempt and hint counts", "private coaching content"],
      guardianProjection: "Server-built allowlist",
      modelStorage: "store: false"
    },
    integrity: { proofHash: "e".repeat(64), generatedAt: "2026-07-18T12:15:00.000Z" }
  };
  await page.route("**/api/proof/open", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(proofView) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Start my day" }).click();
  await expect(page.getByRole("button", { name: /Open .* learning track/ })).toHaveCount(7);
  await page.getByRole("button", { name: "Open Algebra I learning track" }).click();
  await expect(page.getByRole("heading", { name: "Starting Strong in Algebra I" })).toBeVisible();
  await page.getByRole("button", { name: "Start 10-minute session" }).click();
  await expect(page.getByText("We’ll use one quick example, then you’ll take the lead.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Your response to Homeroom" }).fill("Both sides have to stay equal.");
  await page.getByRole("button", { name: "Send to coach" }).click();
  await expect(page.getByText("Exactly—the equality has to remain true.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "End and save session" }).click();
  await expect(page.getByRole("heading", { name: "What Homeroom remembers" })).toBeVisible();
  await expect(page.getByText("One worked example before independent practice.", { exact: true })).toBeVisible();
  await expect(page.getByText("Active dialogue deleted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "What Homeroom remembers" })).toBeHidden();
  await page.getByRole("button", { name: "Ask Matt" }).click();
  await expect(page.getByRole("heading", { name: "Exact notification for Matt" })).toBeVisible();
  await page.getByRole("button", { name: "Approve and notify Matt" }).click();
  await expect(page.getByText("Delivered to Matt's Homeroom inbox", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Preview optional progress summary" }).click();
  const guardianPreview = page.locator(".guardian-preview");
  await expect(guardianPreview.getByRole("heading", { name: "Exactly what Matt will see" })).toBeVisible();
  await expect(guardianPreview.getByText("Not shared yet", { exact: true })).toBeVisible();
  await expect(guardianPreview.getByText("Algebra answer", { exact: true })).toBeVisible();
  await expect(guardianPreview.getByText("private coaching", { exact: true })).toBeVisible();
  await expect(guardianPreview).not.toContainText("x = 4");
  await expect(guardianPreview).not.toContainText("2 attempts");
  await page.getByRole("button", { name: "Approve and share with Matt" }).click();
  await expect(guardianPreview.getByText("Shared with Matt", { exact: true })).toBeVisible();
  await expect(guardianPreview.getByText("STATE 14", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open judge proof" }).click();
  const proof = page.locator(".proof-view");
  await expect(proof.getByRole("heading", { name: "Golden Experience verified" })).toBeVisible();
  await expect(proof.getByText("STATE 15 · COMPLETE", { exact: true })).toBeVisible();
  await expect(proof.getByText("3 LIVE GPT TURNS", { exact: true })).toBeVisible();
  await expect(proof.getByText("get_morning_plan_context", { exact: true })).toBeVisible();
  await expect(proof.getByText("Guardian-safe view published", { exact: true })).toBeVisible();
  await expect(proof.getByText("Private learning details exposed", { exact: true })).toBeVisible();
  await expect(proof).not.toContainText("x = 4");
  await expect(proof).not.toContainText("2 attempts");
});
