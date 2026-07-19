export interface Logger {
  error(event: string, error: unknown, context?: Record<string, string | number | boolean | null>): void;
}

function safeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 6).join("\n") }
    : { name: "UnknownError", message: String(error) };
}

export class StructuredLogger implements Logger {
  constructor(private readonly scope: string) {}

  error(event: string, error: unknown, context: Record<string, string | number | boolean | null> = {}) {
    console.error(JSON.stringify({
      level: "error",
      scope: this.scope,
      event,
      ...context,
      error: safeError(error),
      at: new Date().toISOString()
    }));
  }
}

export const silentLogger: Logger = { error() {} };
