import { USER_HEADER } from "@apps/contracts";
import { fail } from "./util.js";

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
    readonly detail: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(`${service} ${code}: ${detail}`);
  }

  get unreachable(): boolean {
    return this.status === null || this.status >= 500;
  }
}

export async function callJsonWithStatus<T>(
  service: string,
  url: string,
  options: CallOptions = {},
): Promise<{ status: number; body: T }> {
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
    const e = error as Error & { cause?: { code?: string } };
    throw new UpstreamError(service, null, "UNREACHABLE", e.cause?.code ?? e.name);
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const record = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const { statusCode: _status, code: rawCode, message: rawMessage, ...extra } = record;
    const code = typeof rawCode === "string" ? rawCode : `HTTP_${response.status}`;
    const message = typeof rawMessage === "string" ? rawMessage : text.slice(0, 200);
    throw new UpstreamError(service, response.status, code, message, extra);
  }
  return { status: response.status, body: parsed as T };
}

export async function callJson<T>(
  service: string,
  url: string,
  options: CallOptions = {},
): Promise<T> {
  return (await callJsonWithStatus<T>(service, url, options)).body;
}

export const isUnreachable = (error: unknown): boolean =>
  error instanceof UpstreamError && error.unreachable;

// 4xx answers keep status, code and fields; no answer or a 5xx becomes 503.
export function relayUpstream(error: unknown, unavailableCode: string): never {
  if (error instanceof UpstreamError && !error.unreachable) {
    fail(error.status!, error.code, error.detail, error.extra);
  }
  return fail(503, unavailableCode, error instanceof Error ? error.message : String(error));
}
