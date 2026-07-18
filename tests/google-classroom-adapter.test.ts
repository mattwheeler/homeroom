import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_CLASSROOM_SCOPES,
  GoogleClassroomAdapter,
  classifyClassroomCourse,
  createGoogleClassroomAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  refreshGoogleAccessToken
} from "../lib/source/google-classroom";

describe("read-only Google Classroom source adapter", () => {
  it("requests only student-scoped read-only permissions with OAuth state and PKCE", async () => {
    const authorizationUrl = await createGoogleClassroomAuthorizationUrl({
      clientId: "google-client-id.apps.googleusercontent.com",
      redirectUri: "https://homeroom.example/api/integrations/google/callback",
      state: "state_12345678901234567890123456789012",
      codeVerifier: "verifier_123456789012345678901234567890123456789012345678"
    });
    const url = new URL(authorizationUrl);

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("state")).toBe("state_12345678901234567890123456789012");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toContain("verifier");
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([...GOOGLE_CLASSROOM_SCOPES].sort());
    expect(url.searchParams.get("scope")).not.toMatch(/classroom\.courses(?:\s|$)/);
    expect(url.searchParams.get("scope")).not.toMatch(/coursework\.me(?:\s|$)/);
  });

  it("maps recognizable live class names to readiness tracks without a model guess", () => {
    expect(classifyClassroomCourse({ name: "Algebra I - Period 2", subject: "Mathematics" }))
      .toBe("course_algebra_1");
    expect(classifyClassroomCourse({ name: "Wind Ensemble", subject: "Band" }))
      .toBe("course_band");
    expect(classifyClassroomCourse({ name: "Español I" })).toBe("course_spanish_1");
    expect(classifyClassroomCourse({ name: "Life Science" })).toBe("course_biology");
    expect(classifyClassroomCourse({ name: "World Studies" })).toBe("course_world_geography");
    expect(classifyClassroomCourse({ name: "Visual Arts" })).toBe("course_art_1");
    expect(classifyClassroomCourse({ name: "Language Arts" })).toBe("course_english_1");
    expect(classifyClassroomCourse({ name: "Robotics Lab", subject: "Engineering" }))
      .toBeNull();
  });

  it("rejects weak OAuth parameters and unsafe redirect URIs", async () => {
    const valid = {
      clientId: "client.apps.googleusercontent.com",
      redirectUri: "https://homeroom.example/api/integrations/google/callback",
      state: "s".repeat(43),
      codeVerifier: "v".repeat(64)
    };
    await expect(createGoogleClassroomAuthorizationUrl({ ...valid, clientId: "short" })).rejects.toThrow(/client/i);
    await expect(createGoogleClassroomAuthorizationUrl({ ...valid, state: "short" })).rejects.toThrow(/state/i);
    await expect(createGoogleClassroomAuthorizationUrl({ ...valid, codeVerifier: "short" })).rejects.toThrow(/verifier/i);
    await expect(createGoogleClassroomAuthorizationUrl({ ...valid, codeVerifier: "v".repeat(129) })).rejects.toThrow(/verifier/i);
    await expect(createGoogleClassroomAuthorizationUrl({ ...valid, redirectUri: "http://attacker.example/callback" })).rejects.toThrow(/https/i);
    await expect(createGoogleClassroomAuthorizationUrl({ ...valid, redirectUri: "https://user:pass@homeroom.example/callback" })).rejects.toThrow(/invalid/i);
    await expect(createGoogleClassroomAuthorizationUrl({ ...valid, redirectUri: "http://127.0.0.1:3000/callback" })).resolves.toContain("accounts.google.com");
  });

  it("paginates Emily's active courses, published coursework, and only her submissions", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer access-token" });
      expect(url.searchParams.has("access_token")).toBe(false);

      if (url.pathname === "/v1/courses" && !url.searchParams.has("pageToken")) {
        expect(url.searchParams.get("studentId")).toBe("me");
        expect(url.searchParams.getAll("courseStates")).toEqual(["ACTIVE"]);
        return Response.json({
          courses: [{
            id: "google_algebra",
            name: "Algebra I - Period 2",
            section: "Period 2",
            subject: "Mathematics",
            courseState: "ACTIVE",
            alternateLink: "https://classroom.google.com/c/google_algebra",
            calendarId: "algebra@group.calendar.google.com"
          }],
          nextPageToken: "courses-page-2"
        });
      }
      if (url.pathname === "/v1/courses" && url.searchParams.get("pageToken") === "courses-page-2") {
        return Response.json({ courses: [{
          id: "google_band", name: "Concert Band", subject: "Band", courseState: "ACTIVE"
        }] });
      }
      if (url.pathname === "/v1/courses/google_algebra/courseWork") {
        expect(url.searchParams.getAll("courseWorkStates")).toEqual(["PUBLISHED"]);
        expect(url.searchParams.get("orderBy")).toBe("dueDate asc,updateTime desc");
        return Response.json({ courseWork: [{
          id: "work_equations",
          title: "Balancing equations review",
          description: "Complete problems 1-10.",
          state: "PUBLISHED",
          workType: "ASSIGNMENT",
          dueDate: { year: 2026, month: 8, day: 20 },
          dueTime: { hours: 16, minutes: 30 },
          alternateLink: "https://classroom.google.com/c/google_algebra/a/work_equations",
          updateTime: "2026-07-18T12:00:00Z"
        }] });
      }
      if (url.pathname === "/v1/courses/google_algebra/courseWork/-/studentSubmissions") {
        expect(url.searchParams.get("userId")).toBe("me");
        return Response.json({ studentSubmissions: [{
          courseWorkId: "work_equations", state: "CREATED", late: false
        }] });
      }
      if (url.pathname === "/v1/courses/google_band/courseWork") return Response.json({ courseWork: [] });
      if (url.pathname === "/v1/courses/google_band/courseWork/-/studentSubmissions") {
        return Response.json({ studentSubmissions: [] });
      }
      return Response.json({ error: { message: "unexpected request" } }, { status: 500 });
    });

    const snapshot = await new GoogleClassroomAdapter({ fetcher }).syncStudentSnapshot("access-token");

    expect(snapshot.courses).toEqual([
      expect.objectContaining({
        externalId: "google_algebra",
        name: "Algebra I - Period 2",
        trackCourseId: "course_algebra_1",
        provider: "google_classroom"
      }),
      expect.objectContaining({
        externalId: "google_band",
        trackCourseId: "course_band"
      })
    ]);
    expect(snapshot.coursework).toEqual([
      expect.objectContaining({
        externalId: "work_equations",
        courseExternalId: "google_algebra",
        dueDate: "2026-08-20",
        dueTime: "16:30:00",
        submissionState: "CREATED",
        late: false
      })
    ]);
    expect(snapshot.evidenceIds).toEqual(["google_algebra", "google_band", "work_equations"]);
  });

  it("fails closed on provider errors and excessive pagination", async () => {
    const denied = new GoogleClassroomAdapter({
      fetcher: vi.fn().mockResolvedValue(Response.json({ error: { message: "private detail" } }, { status: 403 }))
    });
    await expect(denied.syncStudentSnapshot("access-token")).rejects.toThrow(/classroom source/i);

    const endless = new GoogleClassroomAdapter({
      fetcher: vi.fn().mockImplementation(async () => Response.json({ courses: [], nextPageToken: "again" }))
    });
    await expect(endless.syncStudentSnapshot("access-token")).rejects.toThrow(/pagination/i);

    await expect(new GoogleClassroomAdapter({ fetcher: vi.fn() }).syncStudentSnapshot(""))
      .rejects.toThrow(/access token/i);
    const invalidJson = new GoogleClassroomAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }))
    });
    await expect(invalidJson.syncStudentSnapshot("access-token")).rejects.toThrow(/invalid data/i);
    const oversized = new GoogleClassroomAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response("{}", { headers: { "content-length": "1000001" } }))
    });
    await expect(oversized.syncStudentSnapshot("access-token")).rejects.toThrow(/too large/i);

    const tooMany = new GoogleClassroomAdapter({
      fetcher: vi.fn().mockResolvedValue(Response.json({
        courses: Array.from({ length: 51 }, (_, index) => ({
          id: `course-${index}`,
          name: `Course ${index}`,
          courseState: "ACTIVE"
        }))
      }))
    });
    await expect(tooMany.syncStudentSnapshot("access-token")).rejects.toThrow(/too many/i);
  });

  it("normalizes absent optional coursework and submission fields", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname === "/v1/courses") {
        return Response.json({ courses: [{ id: "english", name: "English I", courseState: "ACTIVE" }] });
      }
      if (url.pathname.endsWith("/courseWork")) {
        return Response.json({ courseWork: [{
          id: "essay",
          title: "Opening paragraph",
          state: "PUBLISHED",
          dueTime: { hours: 9 }
        }] });
      }
      return Response.json({});
    });
    const result = await new GoogleClassroomAdapter({ fetcher }).syncStudentSnapshot("access");
    expect(result.courses[0]).toMatchObject({
      section: null,
      subject: null,
      alternateLink: null,
      calendarId: null,
      trackCourseId: "course_english_1"
    });
    expect(result.coursework[0]).toMatchObject({
      description: null,
      workType: null,
      dueDate: null,
      dueTime: "09:00:00",
      alternateLink: null,
      updateTime: null,
      submissionState: null,
      late: null
    });
  });

  it("exchanges and refreshes tokens server-side without leaking credentials into URLs", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        access_token: "access-01",
        refresh_token: "refresh-01",
        expires_in: 3_600,
        token_type: "Bearer",
        scope: GOOGLE_CLASSROOM_SCOPES.join(" ")
      }))
      .mockResolvedValueOnce(Response.json({
        access_token: "access-02", expires_in: 3_600, token_type: "Bearer"
      }));

    const exchanged = await exchangeGoogleAuthorizationCode({
      code: "authorization-code",
      codeVerifier: "verifier_123456789012345678901234567890123456789012345678",
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "client-secret",
      redirectUri: "https://homeroom.example/api/integrations/google/callback",
      fetcher
    });
    const refreshed = await refreshGoogleAccessToken({
      refreshToken: exchanged.refreshToken!,
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "client-secret",
      fetcher
    });

    expect(exchanged).toMatchObject({ accessToken: "access-01", refreshToken: "refresh-01" });
    expect(refreshed.accessToken).toBe("access-02");
    for (const call of fetcher.mock.calls) {
      expect(call[0]).toBe("https://oauth2.googleapis.com/token");
      expect(String(call[0])).not.toContain("client-secret");
      expect(call[1]).toMatchObject({ method: "POST", redirect: "error" });
    }
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain("code_verifier=");
    expect(String(fetcher.mock.calls[1][1]?.body)).toContain("grant_type=refresh_token");
  });

  it("rejects invalid token requests before contacting Google", async () => {
    const fetcher = vi.fn();
    const exchangeBase = {
      code: "code",
      codeVerifier: "v".repeat(64),
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "secret",
      redirectUri: "https://homeroom.example/callback",
      fetcher
    };
    await expect(exchangeGoogleAuthorizationCode({ ...exchangeBase, code: "" })).rejects.toThrow(/code/i);
    await expect(exchangeGoogleAuthorizationCode({ ...exchangeBase, codeVerifier: "short" })).rejects.toThrow(/verifier/i);
    await expect(exchangeGoogleAuthorizationCode({ ...exchangeBase, clientSecret: "" })).rejects.toThrow(/configured/i);
    await expect(refreshGoogleAccessToken({ refreshToken: "", clientId: "client", clientSecret: "secret", fetcher })).rejects.toThrow(/credentials/i);
    await expect(refreshGoogleAccessToken({ refreshToken: "refresh", clientId: "", clientSecret: "secret", fetcher })).rejects.toThrow(/configured/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
