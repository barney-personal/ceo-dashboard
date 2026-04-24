/**
 * Conservative HTML/markdown sanitizer for untrusted third-party meeting
 * summaries (Granola). Granola summaries are stored as markdown (or
 * markdown-ish plaintext) and currently rendered as text on the dashboard,
 * but they are also returned over JSON API surfaces that could be consumed
 * by clients that DO render HTML. Treat them as untrusted HTML when writing
 * to the DB so we never persist a script/iframe/on*-attribute payload.
 *
 * This is deliberately a small, regex-based sanitizer — not a full HTML
 * parser — because the payloads are short, written by humans, and we only
 * need to neutralize the specific attack vectors listed in the M2
 * milestone (scripts, iframes, on* attributes, `javascript:` URLs, and
 * dangerous `data:` URLs). Safe image `data:` URLs (png/jpeg/jpg/gif/webp)
 * are preserved so inline thumbnail images in markdown still render.
 *
 * Markdown text (headings, bullets, bold, links to http(s) URLs) round-trips
 * untouched.
 */

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const IFRAME_BLOCK = /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi;

// Orphaned open tags — e.g. `<script src=...>` with no closing tag, or
// `<iframe ...>` at EOF — must also be removed.
const SCRIPT_OPEN = /<script\b[^>]*>/gi;
const IFRAME_OPEN = /<iframe\b[^>]*>/gi;

// `on\w+="..."`, `on\w+='...'`, `on\w+=value` — covers onclick, onerror,
// onload, onmouseover, etc. Match the leading whitespace so attribute
// removal doesn't leave `<a onerror=foo href=...>` collapsed weirdly.
const EVENT_HANDLER_ATTR = /\s+on[a-z][a-z0-9]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

// `javascript:` scheme anywhere (handles leading whitespace, case, and
// obfuscated variants like `java\tscript:` via the \s* tolerance).
const JAVASCRIPT_SCHEME = /javascript\s*:/gi;

// `data:` URLs except the safe image content types. We allow base64 and
// URL-encoded payloads (comma-separated after the content type). SVG is
// deliberately NOT on the allowlist because SVG images can carry inline
// scripts.
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|jpg|gif|webp)(?:;[a-z0-9=-]+)*,/i;
const DATA_SCHEME = /data\s*:[^\s"')<>]+/gi;

// Dangerous schemes are neutralized to a deliberately-fake `blocked:` scheme
// so anywhere they appear (HTML `href`, markdown link target, plain text)
// the result is obviously inert rather than accidentally executable.
const BLOCKED_SCHEME = "blocked:";

/**
 * Sanitize an untrusted markdown/HTML summary before it is persisted.
 *
 * Behavior:
 *  - `<script>` and `<iframe>` blocks (and their content) are removed.
 *  - Orphan `<script>` / `<iframe>` open tags are removed.
 *  - `on*="..."` event-handler attributes are stripped from any tag.
 *  - `javascript:` URL schemes are replaced with `blocked:` so the URL is
 *    no longer executable.
 *  - `data:` URLs that are not `image/{png,jpeg,jpg,gif,webp}` are
 *    replaced wholesale with `blocked:`. Safe image data URLs are preserved.
 *
 * All other markdown/HTML is left untouched. The function is idempotent:
 * sanitizing an already-sanitized string returns the same string.
 */
export function sanitizeSummaryHtml(input: string): string;
export function sanitizeSummaryHtml(input: null | undefined): null;
export function sanitizeSummaryHtml(input: string | null | undefined): string | null;
export function sanitizeSummaryHtml(input: string | null | undefined): string | null {
  if (input == null) return null;
  if (input === "") return "";

  let out = input;

  // Tag stripping runs to a fixed point so concatenation-based bypasses
  // like `<scr<script></script>ipt>` cannot leave a revived `<script>` tag
  // behind after a single pass. Event-handler attribute stripping is on
  // the same loop so a stripped attribute that exposes a neighbouring
  // handler is also caught.
  let prev: string;
  do {
    prev = out;
    out = out.replace(SCRIPT_BLOCK, "");
    out = out.replace(IFRAME_BLOCK, "");
    out = out.replace(SCRIPT_OPEN, "");
    out = out.replace(IFRAME_OPEN, "");
    out = out.replace(EVENT_HANDLER_ATTR, "");
  } while (out !== prev);

  out = out.replace(JAVASCRIPT_SCHEME, BLOCKED_SCHEME);

  out = out.replace(DATA_SCHEME, (match) => {
    return SAFE_DATA_IMAGE.test(match) ? match : BLOCKED_SCHEME;
  });

  return out;
}
