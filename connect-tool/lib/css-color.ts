// Strict CSS-color sanitiser for the `accent` brand colour.
//
// The accent is injected as the value of a CSS custom property
// (`--cml-accent: <value>`) via an inline style attribute. React does NOT
// escape custom-property values in a way that prevents extra declarations,
// so an attacker-supplied `?accent=red;background:url(//evil/x)` could
// inject additional CSS (a CSS-injection / data-exfiltration vector — not
// script execution, but still unsafe). We accept ONLY a hex colour, which
// cannot contain the `;`, `:`, `(` or `/` needed to break out.
//
// Hex shapes accepted: #rgb, #rgba, #rrggbb, #rrggbbaa. Anything else →
// null (callers then fall back to the default theme accent).
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function sanitizeAccent(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return HEX_COLOR.test(v) ? v : null;
}
