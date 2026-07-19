import { z } from "zod";

import type { CourseId } from "../domain/learning-tracks";

export const GOOGLE_CLASSROOM_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly"
] as const);

const courseSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(750),
  section: z.string().max(2_800).optional(),
  subject: z.string().max(1_000).optional(),
  courseState: z.literal("ACTIVE"),
  alternateLink: z.string().url().max(2_048).optional(),
  calendarId: z.string().max(512).optional()
}).passthrough();

const courseworkSchema = z.object({
  id: z.string().min(1).max(256),
  title: z.string().min(1).max(3_000),
  description: z.string().max(30_000).optional(),
  state: z.literal("PUBLISHED"),
  workType: z.string().max(64).optional(),
  dueDate: z.object({
    year: z.number().int().min(1).max(9_999),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31)
  }).optional(),
  dueTime: z.object({
    hours: z.number().int().min(0).max(23).optional(),
    minutes: z.number().int().min(0).max(59).optional(),
    seconds: z.number().int().min(0).max(59).optional()
  }).optional(),
  alternateLink: z.string().url().max(2_048).optional(),
  updateTime: z.string().datetime({ offset: true }).optional()
}).passthrough();

const submissionSchema = z.object({
  courseWorkId: z.string().min(1).max(256),
  state: z.string().min(1).max(64),
  late: z.boolean().optional()
}).passthrough();

const coursesPageSchema = z.object({
  courses: z.array(courseSchema).max(100).default([]),
  nextPageToken: z.string().max(2_048).optional()
}).passthrough();

const courseworkPageSchema = z.object({
  courseWork: z.array(courseworkSchema).max(200).default([]),
  nextPageToken: z.string().max(2_048).optional()
}).passthrough();

const submissionsPageSchema = z.object({
  studentSubmissions: z.array(submissionSchema).max(500).default([]),
  nextPageToken: z.string().max(2_048).optional()
}).passthrough();

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(8_192),
  refresh_token: z.string().min(1).max(8_192).optional(),
  expires_in: z.number().int().positive().max(86_400).optional(),
  token_type: z.string().max(64).optional(),
  scope: z.string().max(8_192).optional()
}).passthrough();

export interface ClassroomCourse {
  provider: "google_classroom";
  externalId: string;
  name: string;
  section: string | null;
  subject: string | null;
  courseState: "ACTIVE";
  alternateLink: string | null;
  calendarId: string | null;
  trackCourseId: CourseId | null;
}

export interface ClassroomCoursework {
  provider: "google_classroom";
  externalId: string;
  courseExternalId: string;
  title: string;
  description: string | null;
  workType: string | null;
  dueDate: string | null;
  dueTime: string | null;
  alternateLink: string | null;
  updateTime: string | null;
  submissionState: string | null;
  late: boolean | null;
}

export interface ClassroomSnapshot {
  courses: ClassroomCourse[];
  coursework: ClassroomCoursework[];
  evidenceIds: string[];
}

export class GoogleClassroomSourceError extends Error {
  constructor(
    message: string,
    readonly code:
      | "GOOGLE_SOURCE_UNAVAILABLE"
      | "GOOGLE_TOKEN_INVALID_GRANT"
      | "GOOGLE_TOKEN_INVALID_CLIENT"
      | "GOOGLE_TOKEN_NETWORK_FAILED"
      | "GOOGLE_TOKEN_RESPONSE_INVALID"
      | "GOOGLE_TOKEN_REJECTED" = "GOOGLE_SOURCE_UNAVAILABLE"
  ) {
    super(message);
    this.name = "GoogleClassroomSourceError";
  }
}

export interface GoogleTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
}

function assertRedirectUri(value: string): void {
  const url = new URL(value);
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !local) {
    throw new GoogleClassroomSourceError("Google OAuth redirects must use HTTPS outside local development.");
  }
  if (url.username || url.password || url.hash) {
    throw new GoogleClassroomSourceError("The Google OAuth redirect URI is invalid.");
  }
}

export async function createGoogleClassroomAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): Promise<string> {
  if (input.clientId.length < 10) throw new GoogleClassroomSourceError("Google OAuth client ID is invalid.");
  if (input.state.length < 32) throw new GoogleClassroomSourceError("Google OAuth state is invalid.");
  assertRedirectUri(input.redirectUri);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CLASSROOM_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function classifyClassroomCourse(course: { name: string; subject?: string | null }): CourseId | null {
  const value = `${course.name} ${course.subject ?? ""}`.toLowerCase();
  if (/spanish|espa[nñ]ol/.test(value)) return "course_spanish_1";
  if (/algebra|mathematics|\bmath\b/.test(value)) return "course_algebra_1";
  if (/biology|life science/.test(value)) return "course_biology";
  if (/geography|world studies/.test(value)) return "course_world_geography";
  if (/band|wind ensemble|marching|orchestra/.test(value)) return "course_band";
  if (/\bart\b|visual arts|drawing/.test(value)) return "course_art_1";
  if (/english|language arts|literature/.test(value)) return "course_english_1";
  return null;
}

function dueDate(value: z.infer<typeof courseworkSchema>["dueDate"]): string | null {
  if (!value) return null;
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function dueTime(value: z.infer<typeof courseworkSchema>["dueTime"]): string | null {
  if (!value) return null;
  return `${String(value.hours ?? 0).padStart(2, "0")}:${String(value.minutes ?? 0).padStart(2, "0")}:${String(value.seconds ?? 0).padStart(2, "0")}`;
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > 1_000_000) {
    throw new GoogleClassroomSourceError("The Google Classroom source response is too large.");
  }
  const text = await response.text();
  if (text.length > 1_000_000) throw new GoogleClassroomSourceError("The Google Classroom source response is too large.");
  return text;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const text = await readBoundedText(response);
  if (!response.ok) throw new GoogleClassroomSourceError("The Google Classroom source could not be read.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GoogleClassroomSourceError("The Google Classroom source returned invalid data.");
  }
}

async function tokenRequest(body: URLSearchParams, fetcher: typeof fetch): Promise<GoogleTokenResult> {
  let response: Response;
  try {
    response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      redirect: "manual"
    });
  } catch {
    throw new GoogleClassroomSourceError(
      "Google's token service could not be reached.",
      "GOOGLE_TOKEN_NETWORK_FAILED"
    );
  }
  if (response.status >= 300 && response.status < 400) {
    throw new GoogleClassroomSourceError(
      "Google redirected the token request.",
      "GOOGLE_TOKEN_REJECTED"
    );
  }
  const text = await readBoundedText(response);
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new GoogleClassroomSourceError("Google returned an invalid token response.");
  }
  if (!response.ok) {
    const result = z.object({ error: z.string().max(128) }).passthrough().safeParse(raw);
    const reason = result.success ? result.data.error : "";
    if (reason === "invalid_grant") {
      throw new GoogleClassroomSourceError(
        "Google rejected the authorization grant.",
        "GOOGLE_TOKEN_INVALID_GRANT"
      );
    }
    if (reason === "invalid_client") {
      throw new GoogleClassroomSourceError(
        "Google rejected the OAuth client.",
        "GOOGLE_TOKEN_INVALID_CLIENT"
      );
    }
    throw new GoogleClassroomSourceError(
      "Google rejected the token request.",
      "GOOGLE_TOKEN_REJECTED"
    );
  }
  const parsedResult = tokenResponseSchema.safeParse(raw);
  if (!parsedResult.success) {
    throw new GoogleClassroomSourceError(
      "Google returned an invalid token response.",
      "GOOGLE_TOKEN_RESPONSE_INVALID"
    );
  }
  const parsed = parsedResult.data;
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresIn: parsed.expires_in ?? null,
    scope: parsed.scope ?? null
  };
}

export async function exchangeGoogleAuthorizationCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetcher?: typeof fetch;
}): Promise<GoogleTokenResult> {
  if (!input.code || input.code.length > 4_096) throw new GoogleClassroomSourceError("Google authorization code is invalid.");
  if (!input.clientId || !input.clientSecret) throw new GoogleClassroomSourceError("Google OAuth is not configured.");
  assertRedirectUri(input.redirectUri);
  return tokenRequest(new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code"
  }), input.fetcher ?? fetch);
}

export async function refreshGoogleAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
}): Promise<GoogleTokenResult> {
  if (!input.refreshToken || input.refreshToken.length > 8_192) {
    throw new GoogleClassroomSourceError("Google refresh credentials are invalid.");
  }
  if (!input.clientId || !input.clientSecret) throw new GoogleClassroomSourceError("Google OAuth is not configured.");
  return tokenRequest(new URLSearchParams({
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token"
  }), input.fetcher ?? fetch);
}

export class GoogleClassroomAdapter {
  private readonly fetcher: typeof fetch;

  constructor(input: { fetcher?: typeof fetch } = {}) {
    this.fetcher = input.fetcher ?? fetch;
  }

  private async get(url: URL, accessToken: string): Promise<unknown> {
    return readBoundedJson(await this.fetcher(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      redirect: "manual"
    }));
  }

  private async pages<T>(input: {
    url: URL;
    accessToken: string;
    parse(value: unknown): { records: T[]; nextPageToken?: string };
  }): Promise<T[]> {
    const records: T[] = [];
    let token: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const url = new URL(input.url);
      if (token) url.searchParams.set("pageToken", token);
      const parsed = input.parse(await this.get(url, input.accessToken));
      records.push(...parsed.records);
      token = parsed.nextPageToken;
      if (!token) return records;
    }
    throw new GoogleClassroomSourceError("Google Classroom pagination exceeded the safe limit.");
  }

  async syncStudentSnapshot(accessToken: string): Promise<ClassroomSnapshot> {
    if (!accessToken) throw new GoogleClassroomSourceError("A Google Classroom access token is required.");
    const courseUrl = new URL("https://classroom.googleapis.com/v1/courses");
    courseUrl.searchParams.set("studentId", "me");
    courseUrl.searchParams.append("courseStates", "ACTIVE");
    courseUrl.searchParams.set("pageSize", "100");
    const rawCourses = await this.pages({
      url: courseUrl,
      accessToken,
      parse: (value) => {
        const page = coursesPageSchema.parse(value);
        return { records: page.courses, nextPageToken: page.nextPageToken };
      }
    });
    if (rawCourses.length > 50) throw new GoogleClassroomSourceError("Too many active Classroom courses were returned.");

    const courses: ClassroomCourse[] = rawCourses.map((course) => ({
      provider: "google_classroom",
      externalId: course.id,
      name: course.name,
      section: course.section ?? null,
      subject: course.subject ?? null,
      courseState: "ACTIVE",
      alternateLink: course.alternateLink ?? null,
      calendarId: course.calendarId ?? null,
      trackCourseId: classifyClassroomCourse(course)
    }));
    const coursework: ClassroomCoursework[] = [];
    for (const course of rawCourses) {
      const workUrl = new URL(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(course.id)}/courseWork`);
      workUrl.searchParams.append("courseWorkStates", "PUBLISHED");
      workUrl.searchParams.set("orderBy", "dueDate asc,updateTime desc");
      workUrl.searchParams.set("pageSize", "100");
      const rawWork = await this.pages({
        url: workUrl,
        accessToken,
        parse: (value) => {
          const page = courseworkPageSchema.parse(value);
          return { records: page.courseWork, nextPageToken: page.nextPageToken };
        }
      });
      const submissionsUrl = new URL(
        `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(course.id)}/courseWork/-/studentSubmissions`
      );
      submissionsUrl.searchParams.set("userId", "me");
      submissionsUrl.searchParams.set("pageSize", "100");
      const submissions = await this.pages({
        url: submissionsUrl,
        accessToken,
        parse: (value) => {
          const page = submissionsPageSchema.parse(value);
          return { records: page.studentSubmissions, nextPageToken: page.nextPageToken };
        }
      });
      const byWorkId = new Map(submissions.map((submission) => [submission.courseWorkId, submission]));
      coursework.push(...rawWork.map((work) => {
        const submission = byWorkId.get(work.id);
        return {
          provider: "google_classroom" as const,
          externalId: work.id,
          courseExternalId: course.id,
          title: work.title,
          description: work.description ?? null,
          workType: work.workType ?? null,
          dueDate: dueDate(work.dueDate),
          dueTime: dueTime(work.dueTime),
          alternateLink: work.alternateLink ?? null,
          updateTime: work.updateTime ?? null,
          submissionState: submission?.state ?? null,
          late: submission?.late ?? null
        };
      }));
    }
    return {
      courses,
      coursework,
      evidenceIds: [...courses.map((course) => course.externalId), ...coursework.map((work) => work.externalId)]
    };
  }
}
