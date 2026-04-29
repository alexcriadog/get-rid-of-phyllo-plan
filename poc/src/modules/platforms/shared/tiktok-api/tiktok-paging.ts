// TikTok cursor pagination helpers. F1.
// TikTok returns `{ list, cursor, has_more }` instead of Meta's URL-based
// `paging.next`. Cursors are integers that we just pass back unchanged.

export interface CursorPage<T> {
  list: T[];
  cursor?: number;
  has_more?: boolean;
}

/** True if the API says there's more AND we haven't reached our caller-imposed limit. */
export function shouldContinue<T>(page: CursorPage<T>, collected: number, limit: number): boolean {
  return Boolean(page.has_more) && collected < limit;
}
