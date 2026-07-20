import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SourceConnections } from "../app/components/source-connections";

describe("student source projection", () => {
  it("shows guardian ownership without exposing source mutation controls", () => {
    const markup = renderToStaticMarkup(createElement(SourceConnections, {
      csrfToken: "csrf",
      onCoursesChanged: vi.fn()
    }));

    expect(markup).toContain("Connected school information");
    expect(markup).toContain("Your guardian controls");
    expect(markup).not.toContain("Connect Google Classroom");
    expect(markup).not.toContain("Private BAND calendar URL");
    expect(markup).not.toContain("Refresh Classroom");
  });
});
