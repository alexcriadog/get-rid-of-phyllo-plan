// Zod input shapes for the MCP read tools. The MCP SDK validates tool inputs
// against these at call time. Each shape is a plain object of zod schemas
// (a "raw shape"), NOT a z.object(...).

import { z } from "zod";

export const listAccountsShape = {
  platform: z
    .string()
    .optional()
    .describe("Filter by platform id (e.g. instagram, tiktok, youtube, facebook)"),
};

export const getAccountShape = {
  account_id: z.string().describe("The account UUID returned by list_accounts"),
};

export const getAccountAudienceShape = {
  account_id: z.string().describe("The account UUID returned by list_accounts"),
};

export const listContentShape = {
  account_id: z.string().describe("The account UUID returned by list_accounts"),
  from_date: z
    .string()
    .optional()
    .describe("Lower bound on published_at, ISO YYYY-MM-DD"),
  to_date: z
    .string()
    .optional()
    .describe("Upper bound on published_at, ISO YYYY-MM-DD"),
  limit: z.number().int().min(1).max(100).optional().describe("Max items (default 20)"),
  offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
};

export const getContentAnalyticsShape = {
  content_id: z.string().describe("The content UUID returned by list_content"),
};

export const getContentCommentsShape = {
  account_id: z.string().describe("The account UUID the content belongs to"),
  content_id: z.string().describe("The content UUID returned by list_content"),
  limit: z.number().int().min(1).max(100).optional().describe("Max items (default 20)"),
  offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
};
