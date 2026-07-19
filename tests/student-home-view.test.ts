import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudentHome } from "../app/components/student-home";
import { emilyFixture } from "../lib/domain/fixtures";

describe("calm student home", () => {
  it("starts with a direct age-appropriate invitation and functional student-only tabs", () => {
    const html = renderToStaticMarkup(createElement(StudentHome, {
      student: emilyFixture
    }));

    expect(html).toContain("Hi Emily");
    expect(html).toContain("We’ll pick one thing");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Today");
    expect(html).toContain("Calendar");
    expect(html).toContain("Classes");
    expect(html).toContain("Learn");
    expect(html).toContain("Grade 9 summer readiness is ready");
    expect(html).toContain("Real class names appear only after a school source sync");
    expect(html).not.toContain("Your 7 classes are ready");
    expect(html).not.toContain("Concert and Marching Band");
    expect(html).not.toContain("Guardian");
    expect(html).not.toContain("Matt");
    expect(html).not.toContain("day streak");
  });
});
