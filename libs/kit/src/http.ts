import { USER_HEADER } from "@apps/contracts";

export type CallOptions = {
  method?: string;
  body?: unknown;
  user?: string;
  timeoutMs?: number;
};

// status null means nothing answered (refused, timeout); otherwise the upstream's status and code.
export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number | null,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }

  get unreachable(): boolean {
    return this.status === null || this.status >= 500;
  }
}

export async function callJson<T>(
  service: string,
  url: string,
  options: CallOptions = {},
): Promise<T> {
  const { method = "GET", body, user, timeoutMs = 2000 } = options;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(user ? { [USER_HEADER]: user } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const cause =
      (error as Error & { cause?: { code?: string } }).cause?.code ?? (error as Error).name;
    throw new UpstreamError(service, null, "UNREACHABLE", `${service} unreachable: ${cause}`);
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const record = (parsed ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof record.code === "string" ? record.code : `HTTP_${response.status}`;
    const message = typeof record.message === "string" ? record.message : text.slice(0, 200);
    throw new UpstreamError(service, response.status, code, `${service} ${code}: ${message}`);
  }
  return parsed as T;
}

export const isUnreachable = (error: unknown): boolean =>
  error instanceof UpstreamError && error.unreachable;
