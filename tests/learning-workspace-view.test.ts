import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LearningWorkspace } from "../app/components/learning-workspace";
import { courseFixtures } from "../lib/domain/fixtures";
import { gradeNineSummerLearningOptions } from "../lib/domain/student-learning-options";

describe("attention-aware Learning chooser", () => {
  it("recommends three relevant classes before revealing all seven", () => {
    const html = renderToStaticMarkup(createElement(LearningWorkspace, {
      courses: courseFixtures,
      csrfToken: "csrf"
    }));

    expect(html).toContain("Recommended first");
    expect((html.match(/learning-track-button/g) ?? [])).toHaveLength(3);
    expect(html).toContain("Show all 7 classes");
    expect(html).toContain("Concert and Marching Band");
    expect(html).toContain("Band camp is coming up");
    expect(html).toContain("Practice for upcoming Algebra work");
    expect(html).toContain("From school");
    expect(html).toContain("Readiness practice");
    expect(html).toContain("Life skills");
    expect(html).toContain("Why this is here");
  });

  it("labels grade readiness honestly when no school classes are connected", () => {
    const html = renderToStaticMarkup(createElement(LearningWorkspace, {
      courses: gradeNineSummerLearningOptions,
      csrfToken: "csrf",
      grade: 9
    }));

    expect(html).toContain("GRADE 9 SUMMER READINESS");
    expect(html).toContain("Your school classes aren’t synced yet");
    expect(html).toContain("Math foundations");
    expect(html).toContain("Homeroom-created for Grade 9");
    expect(html).toContain("Readiness practice");
    expect(html).not.toContain("Band camp is coming up");
  });
});
