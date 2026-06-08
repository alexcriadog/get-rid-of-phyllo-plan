// List + error envelope helpers matching InsightIQ's exact response shapes
// (verified live): list = {data, metadata:{offset,limit,from_date,to_date}};
// error = {error:{type,code,error_code,message,status_code,http_status_code,request_id}}.

import type { ApiListEnvelope } from "./api-types";

export function listEnvelope<T>(
  data: T[],
  opts: {
    offset: number;
    limit: number;
    fromDate?: string | null;
    toDate?: string | null;
  },
): ApiListEnvelope<T> {
  return {
    data,
    metadata: {
      offset: opts.offset,
      limit: opts.limit,
      from_date: opts.fromDate ?? null,
      to_date: opts.toDate ?? null,
    },
  };
}

export interface ApiErrorBody {
  error: {
    type: string;
    code: string;
    error_code: string;
    message: string;
    status_code: number;
    http_status_code: number;
    request_id: string;
  };
}

export function errorEnvelope(args: {
  type: string;
  code: string;
  message: string;
  statusCode: number;
  requestId: string;
}): ApiErrorBody {
  return {
    error: {
      type: args.type,
      code: args.code,
      error_code: args.code,
      message: args.message,
      status_code: args.statusCode,
      http_status_code: args.statusCode,
      request_id: args.requestId,
    },
  };
}
