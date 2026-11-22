import { HttpException, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { USER_HEADER, USER_ID_PATTERN } from "@apps/contracts";
import { z } from "zod";

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Exponential, capped; used for outbox and consumer retries.
export const backoffMs = (attempt: number, baseMs = 500, maxMs = 10_000) =>
  Math.min(baseMs * 2 ** attempt, maxMs);

// Every error body has a stable code the UI and tests can branch on.
export function fail(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): never {
  throw new HttpException({ statusCode: status, code, message, ...extra }, status);
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) fail(400, "INVALID_REQUEST", z.prettifyError(result.error));
  return result.data;
}

export function userFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) fail(400, "USER_REQUIRED", `${USER_HEADER} header is required`);
  if (!USER_ID_PATTERN.test(value)) {
    fail(400, "INVALID_USER", `${USER_HEADER} must match ${USER_ID_PATTERN.source}`);
  }
  return value;
}

// The caller named in the X-User header; 400 when missing or malformed.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  userFrom(ctx.switchToHttp().getRequest().headers[USER_HEADER]),
);

// Same header, but anonymous callers are allowed.
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const header = ctx.switchToHttp().getRequest().headers[USER_HEADER];
    return header ? userFrom(header) : null;
  },
);

export function parseLimit(raw: unknown, fallback = 20, max = 100): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    fail(400, "INVALID_REQUEST", `limit must be an integer from 1 to ${max}`);
  }
  return n;
}
