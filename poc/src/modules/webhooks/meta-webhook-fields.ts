// Single source of truth for the Meta webhook field <-> product mapping.
//
// Two directions, two distinct concerns:
//   - FIELD_TO_PRODUCT (inbound): a received webhook's `field` (Page OR
//     Instagram object) -> the internal product whose sync we enqueue.
//     Consumed by webhooks-ingest.controller.ts.
//   - PRODUCT_TO_PAGE_FIELDS (outbound): the products a user selected at
//     connect time -> the Page-object fields we subscribe via
//     POST /{page-id}/subscribed_apps. Page fields only; Instagram object
//     fields are configured app-level in the App Dashboard, not per-Page.

/**
 * Map Meta field names to internal product identifiers. `media`, `comments`,
 * `mentions`, `feed`, `videos`, `live_videos` resolve to `engagement_new`;
 * `story_insights`/`stories` to `stories`; `ratings` to `ratings`.
 */
export const FIELD_TO_PRODUCT: Readonly<Record<string, string>> = {
  media: 'engagement_new',
  comments: 'engagement_new',
  mentions: 'engagement_new',
  feed: 'engagement_new',
  videos: 'engagement_new',
  live_videos: 'engagement_new',
  story_insights: 'stories',
  stories: 'stories',
  ratings: 'ratings',
};

// Product -> Page webhook fields. Only products with Page-object coverage
// appear. `stories` has no Page story webhook field (IG-only, app-level), so
// it is intentionally absent.
const PRODUCT_TO_PAGE_FIELDS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  engagement_new: ['feed', 'videos', 'live_videos'],
  mentions: ['mentions'],
  comments: ['feed'],
  ratings: ['ratings'],
};

/**
 * Deduplicated union of Page webhook fields for the given selected products.
 * Unknown products are ignored. Returns [] when nothing maps (the caller
 * skips the Meta subscribe call entirely).
 */
export function pageFieldsForProducts(
  products: ReadonlyArray<string>,
): string[] {
  const set = new Set<string>();
  for (const product of products) {
    const fields = PRODUCT_TO_PAGE_FIELDS[product];
    if (fields) {
      for (const field of fields) set.add(field);
    }
  }
  return [...set];
}
