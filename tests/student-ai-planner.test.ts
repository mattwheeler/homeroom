import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  StudentAIPlanner,
  STUDENT_PLANNER_ENDPOINTS
} from "../app/components/student-ai-planner";

describe("student AI planner capability", () => {
  it("uses only the live proposal and exact-approval APIs", () => {
    expect(STUDENT_PLANNER_ENDPOINTS).toEqual({
      propose: "/api/morning-plan",
      approve: "/api/morning-plan/approve",
      refresh: "/api/plan-update",
      approveRefresh: "/api/plan-update/approve"
    });
  });

  it("renders as a live, student-controlled planner without forced Golden sequencing", () => {
    const html = renderToStaticMarkup(createElement(StudentAIPlanner, {
      csrfToken: "csrf-student",
      studentName: "Emily"
    }));

    expect(html).toContain("Plan one school day");
    expect(html).toContain("connected assignments and events");
    expect(html).toContain("Suggest a plan for today");
    expect(html).toContain("A SUGGESTION YOU CAN CHANGE");
    expect(html).not.toContain("Build my band-camp routine");
    expect(html).not.toContain("Algebra practice");
    expect(html).not.toContain("SHARE WITH MATT");
    expect(html).not.toContain("Your readiness path");
    expect(html).not.toContain("Approve and save");
    expect(html).not.toContain("Golden demo");
    expect(html).not.toContain("<header");
    expect(html).not.toContain("homeroom</");
  });
});
