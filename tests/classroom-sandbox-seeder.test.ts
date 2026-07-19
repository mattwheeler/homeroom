import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "tools/google-classroom-sandbox");

describe("Google Classroom sandbox seeder artifact", () => {
  it("defines seven recognizable Grade 9 classes and fifteen published assignments", async () => {
    const code = await readFile(join(root, "Code.gs"), "utf8");
    const classNames = [
      "English I - Period 1",
      "Algebra I - Period 2",
      "Biology - Period 3",
      "World Geography - Period 4",
      "Spanish I - Period 5",
      "Concert Band - Period 6",
      "Art I - Period 7"
    ];
    for (const name of classNames) expect(code).toContain(name);
    expect(code.match(/workType: "ASSIGNMENT"/g)).toHaveLength(15);
    expect(code.match(/state: "PUBLISHED"/g)).toHaveLength(15);
    expect(code).toContain("Band Physical Form");
    expect(code).toMatch(/parent or guardian must complete and sign/i);
  });

  it("pairs every assignment due date with the Classroom-required UTC due time", async () => {
    const code = await readFile(join(root, "Code.gs"), "utf8");
    expect(code.match(/dueDate: \{ year:/g)).toHaveLength(15);
    expect(code).toContain("const assignmentWithDeadline = buildCourseWork_(assignment)");
    expect(code).toContain("Classroom.Courses.CourseWork.create(assignmentWithDeadline, course.id)");
  });

  it("builds a plain Classroom payload with complete date and time objects", async () => {
    const code = await readFile(join(root, "Code.gs"), "utf8");
    const sandbox: Record<string, unknown> = {};
    runInNewContext(code, sandbox);
    const buildCourseWork = sandbox.buildCourseWork_ as (assignment: Record<string, unknown>) => unknown;
    expect(buildCourseWork({
      title: "Test assignment",
      description: "Test description",
      dueDate: { year: 2026, month: 8, day: 17 },
      maxPoints: 10,
      workType: "ASSIGNMENT",
      state: "PUBLISHED"
    })).toEqual({
      title: "Test assignment",
      description: "Test description",
      dueDate: { year: 2026, month: 8, day: 17 },
      dueTime: { hours: 23, minutes: 59, seconds: 0, nanos: 0 },
      maxPoints: 10,
      workType: "ASSIGNMENT",
      state: "PUBLISHED"
    });
  });

  it("uses only the three teacher scopes required for courses, coursework, and invitations", async () => {
    const manifest = JSON.parse(await readFile(join(root, "appsscript.json"), "utf8")) as {
      oauthScopes?: string[];
      dependencies?: { enabledAdvancedServices?: Array<{ serviceId?: string; version?: string }> };
    };
    expect(manifest.oauthScopes?.sort()).toEqual([
      "https://www.googleapis.com/auth/classroom.courses",
      "https://www.googleapis.com/auth/classroom.coursework.students",
      "https://www.googleapis.com/auth/classroom.rosters"
    ].sort());
    expect(manifest.dependencies?.enabledAdvancedServices).toContainEqual(expect.objectContaining({
      serviceId: "classroom",
      version: "v1"
    }));
  });

  it("requires the demo student email through Script Properties and contains no credentials", async () => {
    const code = await readFile(join(root, "Code.gs"), "utf8");
    expect(code).toContain('getProperty("HOMEROOM_DEMO_STUDENT_EMAIL")');
    expect(code).not.toMatch(/client_secret|refresh_token|access_token|GOCSPX-|@gmail\.com/i);
    expect(code).toContain("previewHomeroomSandbox");
    expect(code).toContain("seedHomeroomSandbox");
  });

  it("provisions consumer-account courses and pauses for teacher acceptance", async () => {
    const code = await readFile(join(root, "Code.gs"), "utf8");
    expect(code).toContain('courseState: "PROVISIONED"');
    expect(code).not.toContain('courseState: "ACTIVE",');
    expect(code).toContain('courseStates: ["ACTIVE", "PROVISIONED"]');
    expect(code).not.toContain("Classroom.Courses.patch");
    expect(code).toContain("pendingActivation");
    expect(code).toMatch(/accept all.*class cards.*rerun/i);
  });

  it("documents the required human authorization and student acceptance boundary", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toMatch(/teacher authorization/i);
    expect(readme).toMatch(/accept.*invitation/i);
    expect(readme).toMatch(/separate.*Homeroom.*read-only/i);
  });
});
