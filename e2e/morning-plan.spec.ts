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

test("Emily independently uses learning, family help, and a live day plan", async ({ page }) => {
  await page.route("**/api/sessions", async (route) => {
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
  await page.route("**/api/integrations/status", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connections: [{ provider: "google_classroom", status: "active", displayName: "Google Classroom", lastSyncAt: "2026-07-18T12:00:00.000Z", lastErrorCode: null }],
        courses: [{ provider: "google_classroom", externalId: "google-course-algebra", name: "Algebra I - Period 2", section: "P2", subject: "Mathematics", courseState: "ACTIVE", alternateLink: null, calendarId: null, trackCourseId: "course_algebra_1" }],
        coursework: [{ provider: "google_classroom", externalId: "work-1", courseExternalId: "google-course-algebra", title: "Linear equations warm-up", description: null, workType: "ASSIGNMENT", dueDate: "2026-08-18", dueTime: "15:00:00", alternateLink: null, updateTime: "2026-07-18T12:00:00.000Z", submissionState: "NEW", late: false }],
        events: []
      })
    });
  });
  await page.route("**/api/student/projection", async (route) => {
    expect(route.request().headers()["x-homeroom-csrf"]).toBe("csrf-test");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-07-18T12:00:00.000Z",
        context: { localDate: "2026-07-18", age: 14, grade: 9, timeZone: "America/Chicago", scaffoldLevel: "guided_independence", visualFirst: true },
        sourceSummary: { courseCount: 7, actionableCourseworkCount: 14, completedCourseworkCount: 0, eventCount: 0, connections: [] },
        skillScaffolds: [
          { skill: "time_management", label: "Plan the time", studentAction: "Choose a timebox.", adultBoundary: "Student chooses.", visualPattern: "timebox", supportLevel: "developing" },
          { skill: "organization", label: "Set up the work", studentAction: "Gather what you need.", adultBoundary: "Student owns the work.", visualPattern: "course_buckets", supportLevel: "developing" },
          { skill: "prioritization", label: "Choose what matters", studentAction: "Use due date and effort.", adultBoundary: "Student chooses.", visualPattern: "urgency_effort_matrix", supportLevel: "developing" }
        ],
        today: { date: "2026-07-18", timeline: [] },
        week: { startDate: "2026-07-18", endDate: "2026-07-24", days: [{ date: "2026-07-18", label: "Sat, Jul 18", items: [] }] },
        priorities: [{
          id: "google_classroom:coursework:work-1", rank: 1, priorityBand: "plan_next", title: "Linear equations warm-up",
          course: { externalId: "google-course-algebra", name: "Algebra I - Period 2", trackCourseId: "course_algebra_1" },
          due: { date: "2026-08-18", time: "15:00:00" },
          urgency: { level: "later", label: "Due later", visualToken: "green", daysUntilDue: 31 },
          effort: { level: "medium", label: "20-minute focus block", estimatedMinutes: 20, recommendedTimeboxMinutes: 20 },
          rationale: { summary: "Upcoming and ready to plan.", signals: ["Due later", "About 20 minutes", "Not submitted"] },
          chunks: [
            { id: "setup", order: 1, label: "Set up", action: "Open the directions.", minutes: 3, skill: "organization", visualState: "ready" },
            { id: "focus", order: 2, label: "Focus", action: "Work one visible section.", minutes: 12, skill: "time_management", visualState: "next" },
            { id: "check", order: 3, label: "Check", action: "Review and choose the next step.", minutes: 5, skill: "prioritization", visualState: "check" }
          ],
          source: { provider: "google_classroom", recordType: "coursework", externalId: "work-1", sourceUpdatedAt: null }
        }],
        learningRecommendations: [{
          id: "learning:work-1", courseId: "course_algebra_1", courseName: "Algebra I - Period 2",
          missionId: "readiness_algebra_balance_01", missionTitle: "Equations stay balanced",
          objective: "Explain why both sides need the same operation.", suggestedMinutes: 10,
          supportPreference: "example_first", rationale: "Prepare the skill used by upcoming work.",
          visual: { format: "worked_example_then_steps", stepCount: 3, progressStyle: "visible_timebox_and_steps" },
          evidence: []
        }],
        guardianAssistCandidates: [{
          id: "guardian:google_classroom:coursework:physical-form",
          taskId: "google_classroom:coursework:physical-form",
          title: "Band physical form",
          courseName: "Concert Band - Period 6",
          due: { date: "2026-07-24", time: "17:00:00" },
          reason: "The connected school source indicates that a parent or guardian may need to handle this item.",
          source: { provider: "google_classroom", recordType: "coursework", externalId: "physical-form", sourceUpdatedAt: null }
        }],
        classes: [
          ["english", "English I - Period 1", "course_english_1"],
          ["algebra", "Algebra I - Period 2", "course_algebra_1"],
          ["biology", "Biology - Period 3", "course_biology"],
          ["geography", "World Geography - Period 4", "course_world_geography"],
          ["spanish", "Spanish I - Period 5", "course_spanish_1"],
          ["band", "Concert Band - Period 6", "course_band"],
          ["art", "Art I - Period 7", "course_art_1"]
        ].map(([externalId, name, trackCourseId]) => ({
          externalId, name, section: null, subject: null, trackCourseId, alternateLink: null,
          source: { provider: "google_classroom", recordType: "course", externalId, sourceUpdatedAt: null }
        }))
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
    expect(route.request().postDataJSON()).toEqual({ taskId: "google_classroom:coursework:physical-form" });
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
          executiveSkill: "organization",
          nextAction: "Set up both sides before choosing an operation.",
          visualScaffold: {
            kind: "comparison",
            title: "Keep both sides balanced",
            items: [
              { label: "Left side", detail: "Apply one operation." },
              { label: "Right side", detail: "Apply the same operation." }
            ]
          },
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
          executiveSkill: "prioritization",
          nextAction: "Choose the operation that keeps equality true.",
          visualScaffold: {
            kind: "sequence",
            title: "Choose, apply, check",
            items: [
              { label: "Choose", detail: "Name the inverse operation." },
              { label: "Apply", detail: "Use it on both sides." },
              { label: "Check", detail: "Confirm the sides stay equal." }
            ]
          },
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

  await page.goto("/student");
  await expect(page.getByRole("heading", { name: "Grade 9 summer readiness is ready." })).toBeVisible();
  await page.getByRole("button", { name: "Show me my first step" }).click();
  await expect(page.getByRole("heading", { name: "One thing at a time." })).toBeVisible();

  await page.getByRole("tab", { name: "Learn" }).click();
  await page.getByRole("button", { name: "Show all 7 classes" }).click();
  await expect(page.getByRole("button", { name: /Open .* learning track/ })).toHaveCount(7);
  await page.getByRole("button", { name: "Open Algebra I - Period 2 learning track" }).click();
  const learningRoom = page.getByRole("dialog", { name: "Algebra I - Period 2 Learning Room" });
  await expect(learningRoom).toBeVisible();
  await expect(learningRoom.getByRole("heading", { name: "Starting Strong in Algebra I" })).toBeVisible();
  await learningRoom.getByRole("button", { name: "Back to classes" }).click();
  await expect(learningRoom).toBeHidden();
  await page.getByRole("button", { name: "Open Algebra I - Period 2 learning track" }).click();
  await page.getByRole("button", { name: "Start 10-minute session" }).click();
  await expect(learningRoom.getByRole("button", { name: "Back to classes" })).toBeDisabled();
  await expect(page.getByText("We’ll use one quick example, then you’ll take the lead.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Your response to Homeroom" }).fill("Both sides have to stay equal.");
  await page.getByRole("button", { name: "Share my thinking" }).click();
  await expect(page.getByText("Exactly—the equality has to remain true.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "End and save session" }).click();
  await expect(page.getByRole("heading", { name: "What Homeroom remembers" })).toBeVisible();
  await expect(page.getByText("One worked example before independent practice.", { exact: true })).toBeVisible();
  await expect(page.getByText("Active dialogue deleted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "What Homeroom remembers" })).toBeHidden();
  await learningRoom.getByRole("button", { name: "Back to classes" }).click();
  await expect(learningRoom).toBeHidden();

  await page.getByRole("tab", { name: "Today" }).click();
  await page.getByText("Something Matt may need to handle", { exact: true }).click();
  await page.getByRole("button", { name: "Ask Matt about this" }).click();
  await expect(page.getByText("EXACT MESSAGE PREVIEW · NOT SENT YET", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve and notify Matt" }).click();
  await expect(page.getByText("Delivered to Matt’s Homeroom inbox", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Build today’s live plan" }).click();
  const planner = page.getByRole("dialog", { name: "Build a routine from today’s real sources" });
  await planner.getByRole("button", { name: "Suggest a plan for today" }).click();

  await expect(planner.getByRole("heading", { name: plan.title })).toBeVisible();
  await expect(planner.getByText("6:30 AM", { exact: true })).toBeVisible();
  await expect(planner.getByText("7:30 AM", { exact: true })).toBeVisible();
  await expect(planner.getByText("Does this feel useful?", { exact: true })).toBeVisible();
  await planner.getByRole("button", { name: "Use this plan" }).click();
  await expect(planner.getByRole("heading", { name: "Emily, your plan is ready." })).toBeVisible();
  await planner.getByRole("button", { name: "Refresh from latest sources" }).click();
  await expect(planner.getByRole("heading", { name: revision.plan.title })).toBeVisible();
  await expect(planner.getByText("7:15 AM", { exact: true }).first()).toBeVisible();
  await expect(planner.getByText(revision.change.summary, { exact: true })).toBeVisible();
  await planner.getByRole("button", { name: "Use this plan" }).click();
  await expect(planner.getByText("PLAN VERSION 2 SAVED", { exact: true })).toBeVisible();
  await expect(planner.getByText(/ignore it and choose something else/)).toBeVisible();
});
