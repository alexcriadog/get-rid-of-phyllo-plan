// InsightIQ-shaped HttpException helpers + pagination parsing.
import { HttpException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { errorEnvelope } from "@modules/data-schema";

export function apiError(args: {
  type: string;
  code: string;
  message: string;
  statusCode: number;
}): HttpException {
  return new HttpException(
    errorEnvelope({ ...args, requestId: randomUUID() }),
    args.statusCode,
  );
}

export function notFound(code: string, message: string): HttpException {
  return apiError({
    type: "RECORD_NOT_FOUND",
    code,
    message,
    statusCode: 404,
  });
}

export function badRequest(code: string, message: string): HttpException {
  return apiError({
    type: "VALIDATION_ERROR",
    code,
    message,
    statusCode: 400,
  });
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export function parseOffsetLimit(
  offsetRaw: string | undefined,
  limitRaw: string | undefined,
): { offset: number; limit: number } {
  const offset = Math.max(0, toInt(offsetRaw, 0));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, toInt(limitRaw, DEFAULT_LIMIT)),
  );
  return { offset, limit };
}

function toInt(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function parseDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
