import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  LearningPriorityCard,
  LearningSessionRoadmap,
  LearningTimebox,
  SubjectVisualScaffold,
  TaskChunkOrganizer
} from "../app/components/learning-visual-tools";

describe("Learning Room visual executive-function tools", () => {
  it("makes prioritization explicit with one measurable session target", () => {
    const html = renderToStaticMarkup(createElement(LearningPriorityCard, {
      courseName: "Algebra I",
      missionTitle: "Equations stay balanced",
      objective: "Explain why the same operation belongs on both sides."
    }));

    expect(html).toContain("One priority");
    expect(html).toContain("Equations stay balanced");
    expect(html).toContain("Done for today means");
    expect(html).toContain("Explain why the same operation belongs on both sides.");
  });

  it("shows a named session roadmap with the current step exposed to assistive technology", () => {
    const html = renderToStaticMarkup(createElement(LearningSessionRoadmap, {
      phase: "guided_practice",
      completed: false
    }));

    expect(html).toContain("Session roadmap");
    expect(html).toContain("Plan");
    expect(html).toContain("See it");
    expect(html).toContain("Try it");
    expect(html).toContain("Explain it");
    expect(html).toContain("Wrap up");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Current step: Try it");
  });

  it("turns the timebox into a bounded visual progress indicator", () => {
    const html = renderToStaticMarkup(createElement(LearningTimebox, {
      durationMinutes: 10,
      remainingSeconds: 300,
      active: true
    }));

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="600"');
    expect(html).toContain('aria-valuenow="300"');
    expect(html).toContain("05:00");
    expect(html).toContain("Halfway there");
  });

  it("organizes the task into small visible chunks and identifies the active chunk", () => {
    const html = renderToStaticMarkup(createElement(TaskChunkOrganizer, {
      phase: "transfer",
      completed: false
    }));

    expect(html).toContain("Break it into 3 chunks");
    expect(html).toContain("Understand");
    expect(html).toContain("Practice");
    expect(html).toContain("Show what you know");
    expect(html).toContain("Current chunk");
  });

  it("uses a subject-specific visual model as instructional content, with a text alternative", () => {
    const html = renderToStaticMarkup(createElement(SubjectVisualScaffold, {
      coachMode: "guided_problem_solving",
      courseName: "Algebra I",
      phase: "guided_practice"
    }));

    expect(html).toContain("Balance both sides");
    expect(html).toContain('role="img"');
    expect(html).toContain("A balance scale showing the same action on both sides");
    expect(html).toContain("Do the same thing to each side");
  });

  it("renders the live coach's structured visual scaffold instead of treating it as prose", () => {
    const html = renderToStaticMarkup(createElement(SubjectVisualScaffold, {
      coachMode: "guided_problem_solving",
      courseName: "Algebra I",
      phase: "transfer",
      visualScaffold: {
        kind: "sequence",
        title: "Solve in visible steps",
        items: [
          { label: "Notice", detail: "Find the operation beside x." },
          { label: "Balance", detail: "Apply its inverse to both sides." },
          { label: "Check", detail: "Substitute your value." }
        ]
      }
    }));

    expect(html).toContain("Solve in visible steps");
    expect(html).toContain("Notice");
    expect(html).toContain("Apply its inverse to both sides.");
    expect(html).toContain("Check");
    expect(html).toContain("structured sequence");
    expect(html).toContain("Solve in visible steps: Notice, Find the operation beside x.");
  });
});
