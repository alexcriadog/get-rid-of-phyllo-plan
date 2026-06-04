// Restli 2.0 query-value builders. LinkedIn's versioned REST API uses
// structured query params — (key:value) records, List(...) arrays — whose
// parens/commas/colons MUST stay raw, while URN values inside them must be
// percent-encoded. axios's default serializer would encode everything, so
// the LinkedIn client builds query strings by hand with these helpers.

/** Percent-encode a URN for use inside a path or query value. */
export function encodeUrn(urn: string): string {
  return encodeURIComponent(urn);
}

/** `(year:2026,month:5,day:4)` — UTC calendar date. */
export function restliDate(d: Date): string {
  return `(year:${d.getUTCFullYear()},month:${d.getUTCMonth() + 1},day:${d.getUTCDate()})`;
}

/** `(start:(...),end:(...))` — start inclusive, end exclusive (per docs). */
export function restliDateRange(start: Date, end: Date): string {
  return `(start:${restliDate(start)},end:${restliDate(end)})`;
}

/** `List(a,b,c)` with each item URN-encoded but commas raw. */
export function restliList(urns: ReadonlyArray<string>): string {
  return `List(${urns.map(encodeUrn).join(',')})`;
}

/** `(timeRange:(start:ms,end:ms),timeGranularityType:DAY)` */
export function restliTimeIntervals(startMs: number, endMs: number): string {
  return `(timeRange:(start:${startMs},end:${endMs}),timeGranularityType:DAY)`;
}
