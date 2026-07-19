import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudentHome } from "../app/components/student-home";
import { emilyFixture } from "../lib/domain/fixtures";

describe("calm student home", () => {
  it("starts one authenticated Today lifecycle without a duplicate welcome gateway", () => {
    const html = renderToStaticMarkup(createElement(StudentHome, {
      student: emilyFixture
    }));

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Today");
    expect(html).toContain("Calendar");
    expect(html).toContain("Classes");
    expect(html).toContain("Learn");
    expect(html).toContain("Opening Emily’s Today page");
    expect(html).toContain("Connecting verified school sources");
    expect(html).not.toContain("Show me my first step");
    expect(html).not.toContain("Grade 9 summer readiness is ready");
    expect(html).not.toContain("Your 7 classes are ready");
    expect(html).not.toContain("Concert and Marching Band");
    expect(html).not.toContain("Guardian");
    expect(html).not.toContain("Matt");
    expect(html).not.toContain("day streak");
  });
});
