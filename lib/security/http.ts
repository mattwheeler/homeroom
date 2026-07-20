export class HttpSecurityError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpSecurityError";
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new HttpSecurityError(403, "A same-origin request is required.");
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new HttpSecurityError(403, "The request origin is invalid.");
  }
  if (origin !== requestOrigin) throw new HttpSecurityError(403, "The request origin is not allowed.");
}

export function assertJsonRequest(request: Request): void {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new HttpSecurityError(415, "A JSON request body is required.");
  }
}

export function serializeSessionCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds: number }
): string {
  const parts = [
    `homeroom_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function serializeIdentityCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds: number }
): string {
  const parts = [
    `homeroom_identity=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return serializeSessionCookie("", { secure, maxAgeSeconds: 0 });
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function verifyCsrfToken(token: string, expectedHash: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const actualHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(actualHash, expectedHash);
}
