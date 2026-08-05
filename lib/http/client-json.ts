export class ClientResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rayId: string | null,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "ClientResponseError";
  }
}

export async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const rayId = response.headers.get("cf-ray");
  const retryable = response.status === 429 || response.status >= 500;

  if (!contentType.includes("application/json")) {
    throw new ClientResponseError(fallbackMessage, response.status, rayId, retryable);
  }

  try {
    return await response.json() as T;
  } catch {
    throw new ClientResponseError(fallbackMessage, response.status, rayId, retryable);
  }
}
