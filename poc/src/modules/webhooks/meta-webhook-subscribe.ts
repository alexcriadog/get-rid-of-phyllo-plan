import type { Logger } from '@nestjs/common';

// Graph version pinned to match the rest of the POC's Meta calls
// (admin.service.ts GRAPH_VERSION).
const GRAPH_VERSION = 'v22.0';

export interface SubscribePoster {
  (
    url: string,
    params: Record<string, string>,
  ): Promise<{ status: number; data: unknown }>;
}

export interface SubscribeMetrics {
  incr(name: string, labels?: Record<string, string>): void;
}

export interface SubscribeDeps {
  post: SubscribePoster;
  metrics: SubscribeMetrics;
  logger: Logger;
}

export interface SubscribeArgs {
  platform: string;
  pageId: string;
  fields: ReadonlyArray<string>;
  accessToken: string;
}

export interface SubscribeResult {
  subscribed: boolean;
  error?: string;
}

/**
 * Subscribe a Page to the app's webhooks via POST /{page-id}/subscribed_apps.
 *
 * Non-blocking by contract: NEVER throws. Failures (timeout, missing
 * permission, #200, rate limit, non-2xx) are logged + counted and returned as
 * { subscribed: false, error }. Subscribing the Page also activates delivery
 * for its linked Instagram business account (IG object fields are configured
 * app-level, not per-Page).
 */
export async function subscribePageToApp(
  deps: SubscribeDeps,
  args: SubscribeArgs,
): Promise<SubscribeResult> {
  if (args.fields.length === 0) {
    return { subscribed: false };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${args.pageId}/subscribed_apps`;
  try {
    const res = await deps.post(url, {
      subscribed_fields: [...args.fields].join(','),
      access_token: args.accessToken,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }
    deps.metrics.incr('webhook_subscribe_ok', { platform: args.platform });
    deps.logger.log(
      `Subscribed page ${args.pageId} to webhooks (${args.fields.join(',')})`,
    );
    return { subscribed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.metrics.incr('webhook_subscribe_failed', { platform: args.platform });
    deps.logger.warn(
      `Webhook subscribe failed for page ${args.pageId}: ${message}`,
    );
    return { subscribed: false, error: message };
  }
}
