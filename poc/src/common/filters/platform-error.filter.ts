import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AdapterFetchError,
  RateLimitedError,
  TokenRevokedError,
} from '@modules/platforms/shared/platform-adapter.port';

/**
 * Maps platform-adapter exceptions to proper HTTP responses instead of
 * letting Nest collapse them to 500s.
 *
 *   TokenRevokedError → 401 needs_reauth
 *     The end-user must reconnect their platform account. The client
 *     should prompt them via the SDK again.
 *
 *   RateLimitedError → 503 upstream_rate_limited
 *     We hit Meta/Twitch/etc's rate limit. Distinct from our 429 which
 *     is workspace-scoped on /v1/*.
 *
 *   AdapterFetchError → 502 upstream_unreachable
 *     Generic upstream failure (timeout, parse error, unexpected non-2xx).
 *     Body of the upstream error is preserved when it parsed as JSON.
 */
@Catch(TokenRevokedError, RateLimitedError, AdapterFetchError)
export class PlatformErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(PlatformErrorFilter.name);

  catch(
    err: TokenRevokedError | RateLimitedError | AdapterFetchError,
    host: ArgumentsHost,
  ): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof TokenRevokedError) {
      this.logger.warn(
        `[${err.platform}] token revoked for ${err.canonicalId}`,
      );
      res.status(HttpStatus.UNAUTHORIZED).json({
        error: 'token_revoked',
        message:
          'The platform rejected the stored access token. The end-user needs to reconnect.',
        platform: err.platform,
        canonical_user_id: err.canonicalId,
        statusCode: HttpStatus.UNAUTHORIZED,
      });
      return;
    }

    if (err instanceof RateLimitedError) {
      this.logger.warn(
        `[${err.platform}] platform rate limit hit (bucket=${err.bucketKey}, reset_in_ms=${err.resetInMs})`,
      );
      const retryAfter = Math.max(1, Math.ceil(err.resetInMs / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        error: 'upstream_rate_limited',
        message:
          'The upstream platform is rate-limiting our requests. Try again in a few seconds.',
        platform: err.platform,
        retry_after_seconds: retryAfter,
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      });
      return;
    }

    // AdapterFetchError
    this.logger.error(
      `[${err.platform}] adapter fetch failed at ${err.endpoint}: ${err.message}`,
    );
    res.status(HttpStatus.BAD_GATEWAY).json({
      error: 'upstream_error',
      message: err.message,
      platform: err.platform,
      endpoint: err.endpoint,
      upstream_body: err.body ?? null,
      statusCode: HttpStatus.BAD_GATEWAY,
    });
  }
}
