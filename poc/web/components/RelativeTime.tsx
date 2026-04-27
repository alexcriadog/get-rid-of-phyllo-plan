import { useEffect, useState } from 'react';
import { fmtRelative } from '../lib/format';

/**
 * SSR-safe wrapper around fmtRelative. The server renders one value
 * computed at request time; by the time the client hydrates a few seconds
 * later, fmtRelative produces a different string ("41s ago" -> "44s ago"),
 * which React flags as a hydration mismatch. We:
 *   1. Render the SSR-computed string verbatim on first paint.
 *   2. Tell React not to compare its text during hydration
 *      (`suppressHydrationWarning`) so the slight drift is silent.
 *   3. Update the value once on mount and then every 30s so the page
 *      keeps ticking without a re-render storm.
 */
export function RelativeTime({
  value,
}: {
  value: string | number | Date | null | undefined;
}) {
  const [text, setText] = useState(() => fmtRelative(value));

  useEffect(() => {
    setText(fmtRelative(value));
    const id = setInterval(() => setText(fmtRelative(value)), 30_000);
    return () => clearInterval(id);
  }, [value]);

  return <span suppressHydrationWarning>{text}</span>;
}
