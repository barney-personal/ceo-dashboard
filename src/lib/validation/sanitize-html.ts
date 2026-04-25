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

// ---------------------------------------------------------------------------
// URL-scheme obfuscation bypass defenses (M15 + M16 + M17).
//
// A literal regex like `/javascript\s*:/` does not catch browser-normalized
// obfuscation. The WHATWG URL parser strips ASCII tab/LF/CR from the scheme,
// and the HTML parser decodes both numeric character references (`&#x73;`,
// `&#115;`, and the semicolonless forms `&#x73` / `&#115` consumed greedily)
// and a small set of named character references (`&colon;`, `&Tab;`,
// `&NewLine;`) inside attribute values and markdown link targets. So
// `java\nscript:...`, `java&#x73;cript:...`, `jav&#x09;ascript:...`,
// `data&#58;text/html,...`, `javascript&colon;alert(1)`, and the semicolonless
// forms `javascript&#58alert(1)` / `java&#115cript:alert(1)` / unquoted
// `<a href=javascript&#58alert(1)>` all render as executable `javascript:` /
// unsafe `data:` URLs even though the literal text does not contain the
// dangerous scheme word.
//
// We handle this by scanning URL-accepting contexts — HTML attribute values
// (double-quoted, single-quoted, and unquoted) and markdown link targets —
// normalizing each URL value the way a browser would (decode numeric char
// refs with or without trailing `;`, greedily consuming digits/hex digits, +
// decode a narrow set of scheme-relevant named refs + strip 0x00-0x1F), and
// if the normalized form starts with a dangerous scheme, replacing the URL
// content wholesale with `blocked:`. Benign URLs (including ones with char
// refs in the path, benign named entities in surrounding text, or malformed
// hex forms that browsers do not normalize into a dangerous scheme) are
// left untouched — we only rewrite when normalization would change the
// string AND the normalized form is dangerous.
// ---------------------------------------------------------------------------

// Browsers accept numeric character references both with and without a
// trailing `;`, consuming as many matching digits (or hex digits) as possible.
// E.g. `&#115cript` greedily consumes `115` (decoded to `s`) and stops at `c`;
// `&#x3Aa` greedily consumes `3Aa` (decoded to `\u03aa`, which is NOT `:`,
// matching browser behavior). The trailing `;` is consumed when present so
// it doesn't leak into the decoded output.
const NUMERIC_CHAR_REF = /&#(x[0-9a-f]+|[0-9]+);?/gi;
// C0 controls (0x00-0x1F). Browsers strip ASCII tab/LF/CR from URL schemes;
// we strip the full C0 range because other controls inside a scheme are
// never valid and some renderers tolerate them.
const URL_CONTROL_CHARS = /[\x00-\x1f]/g;

// Named HTML character references that browsers decode inside URL attribute
// values and markdown link targets and that map to scheme-relevant characters
// (colon, tab, newline). HTML5 defines these case-sensitively, but we accept
// common case variants because this is a sanitizer, not a renderer —
// over-decoding is safe, under-decoding is not. Keep this set narrow: only
// entities whose decoded form could bypass scheme detection. Other named
// entities are left intact so benign text outside URL contexts is unchanged.
const NAMED_URL_CHAR_REFS: Record<string, string> = {
  "&colon;": ":",
  "&Colon;": ":",
  "&Tab;": "\t",
  "&tab;": "\t",
  "&NewLine;": "\n",
  "&newline;": "\n",
};
const NAMED_CHAR_REF = /&[A-Za-z]+;/g;

function decodeNumericCharRefs(value: string): string {
  return value.replace(NUMERIC_CHAR_REF, (_, codeStr: string) => {
    const isHex = codeStr[0]?.toLowerCase() === "x";
    const code = isHex ? parseInt(codeStr.slice(1), 16) : parseInt(codeStr, 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
    try {
      return String.fromCodePoint(code);
    } catch {
      return "";
    }
  });
}

function decodeNamedUrlCharRefs(value: string): string {
  return value.replace(NAMED_CHAR_REF, (match) => NAMED_URL_CHAR_REFS[match] ?? match);
}

function normalizeUrl(url: string): string {
  return decodeNamedUrlCharRefs(decodeNumericCharRefs(url)).replace(
    URL_CONTROL_CHARS,
    "",
  );
}

function isDangerousAfterNormalization(normalized: string): boolean {
  const trimmed = normalized.replace(/^\s+/, "");
  if (/^javascript\s*:/i.test(trimmed)) return true;
  if (/^data\s*:/i.test(trimmed)) {
    return !SAFE_DATA_IMAGE.test(trimmed);
  }
  return false;
}

// Only rewrite when normalization changed the URL AND the normalized form is
// dangerous. Literal `javascript:` / `data:text/html,...` without obfuscation
// is still handled by the downstream JAVASCRIPT_SCHEME / DATA_SCHEME passes
// (which preserve more of the original string for diagnostic value).
function maybeNeutralizeObfuscatedUrl(url: string): string | null {
  const normalized = normalizeUrl(url);
  if (normalized === url) return null;
  return isDangerousAfterNormalization(normalized) ? BLOCKED_SCHEME : null;
}

// `data` covers `<object data="...">`, the src-equivalent attribute on
// `<object>` (also accepted by some browsers as a navigable target). Without
// it, an obfuscated `javascript:` payload inside `<object data="java&#115;cript:...">`
// would skip the URL-attribute normalization pass and only fall through to
// the literal JAVASCRIPT_SCHEME regex, which does not handle entity-encoded
// schemes.
const URL_ATTR_NAMES =
  "href|src|xlink:href|formaction|action|background|poster|cite|manifest|ping|data";

// Double-quoted URL attribute values: href="..." etc.
const URL_ATTR_DOUBLE_QUOTED = new RegExp(
  `\\b(${URL_ATTR_NAMES})(\\s*=\\s*)"([^"]*)"`,
  "gi",
);
// Single-quoted URL attribute values: href='...' etc.
const URL_ATTR_SINGLE_QUOTED = new RegExp(
  `\\b(${URL_ATTR_NAMES})(\\s*=\\s*)'([^']*)'`,
  "gi",
);
// Unquoted URL attribute values: href=value — first char must not be a quote
// (so we don't partially match a quoted value) and the run ends at whitespace
// or `>`. Run after the quoted passes so already-replaced values don't match.
const URL_ATTR_UNQUOTED = new RegExp(
  `\\b(${URL_ATTR_NAMES})(\\s*=\\s*)([^\\s"'>][^\\s>]*)`,
  "gi",
);
// Markdown link target: ](url) or ](url "title"). We only capture the URL
// portion; title handling is unchanged.
const MARKDOWN_LINK_TARGET = /(\]\(\s*)([^)\s]+)/g;

function neutralizeObfuscatedUrlsInAttributes(input: string): string {
  let out = input.replace(
    URL_ATTR_DOUBLE_QUOTED,
    (match, name: string, eq: string, url: string) => {
      const replacement = maybeNeutralizeObfuscatedUrl(url);
      return replacement == null ? match : `${name}${eq}"${replacement}"`;
    },
  );
  out = out.replace(
    URL_ATTR_SINGLE_QUOTED,
    (match, name: string, eq: string, url: string) => {
      const replacement = maybeNeutralizeObfuscatedUrl(url);
      return replacement == null ? match : `${name}${eq}'${replacement}'`;
    },
  );
  out = out.replace(
    URL_ATTR_UNQUOTED,
    (match, name: string, eq: string, url: string) => {
      const replacement = maybeNeutralizeObfuscatedUrl(url);
      return replacement == null ? match : `${name}${eq}${replacement}`;
    },
  );
  return out;
}

function neutralizeObfuscatedUrlsInMarkdown(input: string): string {
  return input.replace(MARKDOWN_LINK_TARGET, (match, prefix: string, url: string) => {
    const replacement = maybeNeutralizeObfuscatedUrl(url);
    return replacement == null ? match : `${prefix}${replacement}`;
  });
}

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

  // Catch browser-normalized scheme obfuscations (control chars inside the
  // scheme, HTML char refs in the scheme or colon) before the literal-scheme
  // passes below. Benign URLs and literal `javascript:`/`data:` schemes are
  // untouched here — the downstream passes handle them.
  out = neutralizeObfuscatedUrlsInAttributes(out);
  out = neutralizeObfuscatedUrlsInMarkdown(out);

  out = out.replace(JAVASCRIPT_SCHEME, BLOCKED_SCHEME);

  out = out.replace(DATA_SCHEME, (match) => {
    return SAFE_DATA_IMAGE.test(match) ? match : BLOCKED_SCHEME;
  });

  return out;
}
