import { describe, expect, it } from "vitest";
import { sanitizeSummaryHtml } from "../sanitize-html";

describe("sanitizeSummaryHtml", () => {
  describe("null/empty handling", () => {
    it("returns null for null input", () => {
      expect(sanitizeSummaryHtml(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
      expect(sanitizeSummaryHtml(undefined)).toBeNull();
    });

    it("returns empty string for empty input", () => {
      expect(sanitizeSummaryHtml("")).toBe("");
    });
  });

  describe("benign markdown content round-trips untouched", () => {
    it("preserves headings and bullets", () => {
      const input = "# Summary\n\n## Action items\n\n- do X\n- do Y";
      expect(sanitizeSummaryHtml(input)).toBe(input);
    });

    it("preserves bold and italic markdown", () => {
      const input = "**important** and _italic_ words";
      expect(sanitizeSummaryHtml(input)).toBe(input);
    });

    it("preserves http and https markdown links", () => {
      const input = "[docs](https://example.com/a?b=1)";
      expect(sanitizeSummaryHtml(input)).toBe(input);
    });

    it("preserves plain text containing 'on' in normal words (not as attribute)", () => {
      const input = "Met with Alex on Tuesday; turnaround is on track.";
      expect(sanitizeSummaryHtml(input)).toBe(input);
    });

    it("preserves inline code and fenced blocks", () => {
      const input = "Call `api.get('/foo')` and then:\n```\ncurl -X POST https://api\n```";
      expect(sanitizeSummaryHtml(input)).toBe(input);
    });
  });

  describe("script blocks", () => {
    it("strips <script> block including contents", () => {
      const input = "Hi <script>alert(1)</script> there";
      expect(sanitizeSummaryHtml(input)).toBe("Hi  there");
    });

    it("strips script with attributes and mixed case", () => {
      const input = 'Start<SCRIPT src="evil.js" defer>malicious()</ScRiPt>End';
      expect(sanitizeSummaryHtml(input)).toBe("StartEnd");
    });

    it("strips multi-line script blocks", () => {
      const input = "before\n<script>\nevil();\nmore();\n</script>\nafter";
      expect(sanitizeSummaryHtml(input)).toBe("before\n\nafter");
    });

    it("strips orphan opening <script> tags", () => {
      const input = "oops <script src=//evil.tld/x.js> trailing";
      expect(sanitizeSummaryHtml(input)).toBe("oops  trailing");
    });
  });

  describe("iframe blocks", () => {
    it("strips <iframe> block including contents", () => {
      const input = 'intro <iframe src="https://evil.tld"></iframe> outro';
      expect(sanitizeSummaryHtml(input)).toBe("intro  outro");
    });

    it("strips orphan <iframe> open tag", () => {
      const input = 'body <iframe src="//evil.tld"> trailing';
      expect(sanitizeSummaryHtml(input)).toBe("body  trailing");
    });
  });

  describe("event handler attributes", () => {
    it("strips onclick from preserved tag", () => {
      const input = '<a href="https://example.com" onclick="alert(1)">x</a>';
      expect(sanitizeSummaryHtml(input)).toBe('<a href="https://example.com">x</a>');
    });

    it("strips onerror from img and preserves rest of tag", () => {
      const input = '<img src="x" onerror="alert(1)">';
      expect(sanitizeSummaryHtml(input)).toBe('<img src="x">');
    });

    it("strips multiple event handlers in one tag", () => {
      const input = '<div onmouseover="a()" onclick="b()">hi</div>';
      expect(sanitizeSummaryHtml(input)).toBe("<div>hi</div>");
    });

    it("strips unquoted event handler attribute values", () => {
      const input = "<a href=x onclick=evil()>hi</a>";
      expect(sanitizeSummaryHtml(input)).toBe("<a href=x>hi</a>");
    });

    it("strips single-quoted event handler attribute values", () => {
      const input = "<a onclick='evil()' href='x'>hi</a>";
      expect(sanitizeSummaryHtml(input)).toBe("<a href='x'>hi</a>");
    });

    it("is case-insensitive on event handler names", () => {
      const input = '<div OnClick="evil()">x</div>';
      expect(sanitizeSummaryHtml(input)).toBe("<div>x</div>");
    });
  });

  describe("javascript: URLs", () => {
    it("neutralizes javascript: scheme in href", () => {
      const input = '<a href="javascript:alert(1)">click</a>';
      expect(sanitizeSummaryHtml(input)).toBe('<a href="blocked:alert(1)">click</a>');
    });

    it("neutralizes javascript: scheme in markdown link", () => {
      const input = "[click](javascript:alert(1))";
      expect(sanitizeSummaryHtml(input)).toBe("[click](blocked:alert(1))");
    });

    it("is case-insensitive on javascript: scheme", () => {
      const input = "see JavaScript:alert(1)";
      expect(sanitizeSummaryHtml(input)).toBe("see blocked:alert(1)");
    });
  });

  describe("data: URLs", () => {
    it("neutralizes data:text/html URLs", () => {
      const input = '<a href="data:text/html,<script>alert(1)</script>">x</a>';
      const result = sanitizeSummaryHtml(input);
      expect(result).not.toContain("data:");
      expect(result).not.toContain("<script>");
      expect(result).toContain("blocked:");
    });

    it("neutralizes data:application/javascript URLs", () => {
      const input = '<a href="data:application/javascript,evil()">x</a>';
      const result = sanitizeSummaryHtml(input);
      expect(result).not.toMatch(/data:application\/javascript/);
      expect(result).toContain("blocked:");
    });

    it("neutralizes data:image/svg+xml URLs (can contain scripts)", () => {
      const input = '<img src="data:image/svg+xml;base64,PHN2Zy8+">';
      expect(sanitizeSummaryHtml(input)).toBe('<img src="blocked:">');
    });

    it("preserves safe data:image/png base64 URLs", () => {
      const input = '<img src="data:image/png;base64,iVBORw0KGgo=">';
      expect(sanitizeSummaryHtml(input)).toBe(input);
    });

    it("preserves safe data:image/jpeg URLs", () => {
      const input = '<img src="data:image/jpeg;base64,/9j/4AAQSk=">';
      expect(sanitizeSummaryHtml(input)).toBe(input);
    });
  });

  describe("combined malicious payloads", () => {
    it("strips script tag, event handler, and javascript: URL together", () => {
      const input =
        '# Summary\n<script>steal()</script>\n- **action** <a href="javascript:evil()" onclick="more()">x</a>';
      const result = sanitizeSummaryHtml(input);
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("onclick");
      expect(result).not.toContain("javascript:");
      expect(result).toContain("# Summary");
      expect(result).toContain("**action**");
      expect(result).toContain("blocked:");
    });

    it("handles nested attempt to re-introduce script via concatenation", () => {
      const input = "<scr<script></script>ipt>alert(1)</script>";
      const result = sanitizeSummaryHtml(input);
      expect(result).not.toMatch(/<script[^>]*>/i);
    });
  });

  describe("URL-scheme obfuscation (M15)", () => {
    describe("control chars inside scheme", () => {
      it("neutralizes javascript: with embedded newline in href", () => {
        const input = '<a href="java\nscript:alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).not.toMatch(/java\s*script\s*:/i);
        expect(result).toContain("blocked:");
      });

      it("neutralizes javascript: with embedded tab in href", () => {
        const input = '<a href="java\tscript:alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("alert(1)");
      });

      it("neutralizes javascript: with embedded carriage return", () => {
        const input = '<a href="java\rscript:alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
      });

      it("neutralizes control-char obfuscated javascript: in single-quoted href", () => {
        const input = "<a href='java\nscript:alert(1)'>x</a>";
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("alert(1)");
      });
    });

    describe("HTML character reference obfuscation", () => {
      it("neutralizes hex-encoded scheme letter in href", () => {
        // &#x73; = 's'
        const input = '<a href="java&#x73;cript:alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("alert(1)");
      });

      it("neutralizes decimal-encoded scheme letter in href", () => {
        // &#115; = 's'
        const input = '<a href="java&#115;cript:alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
      });

      it("neutralizes hex-encoded colon in data: URL", () => {
        // &#58; = ':'
        const input = '<a href="data&#58;text/html,<b>x</b>">y</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("data&#58;");
        expect(result).not.toContain("data:text/html");
      });

      it("neutralizes hex-encoded tab inside javascript scheme in markdown link", () => {
        // &#x09; = tab
        const input = "[x](jav&#x09;ascript:alert(1))";
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("alert(1)");
        // Markdown link prefix is preserved
        expect(result).toContain("[x](");
      });

      it("neutralizes uppercase hex char ref", () => {
        // &#X73; (uppercase X) = 's'
        const input = '<a href="java&#X73;cript:alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
      });
    });

    describe("benign obfuscation-adjacent content is preserved", () => {
      it("leaves http links with decimal char ref in path untouched", () => {
        // &#47; = '/' — not dangerous even after decode
        const input = '<a href="https://example.com&#47;path">docs</a>';
        expect(sanitizeSummaryHtml(input)).toBe(input);
      });

      it("leaves ordinary markdown http link with newline-adjacent text untouched", () => {
        const input = "hi\n\n[docs](https://example.com/a?b=1)\n\nbye";
        expect(sanitizeSummaryHtml(input)).toBe(input);
      });

      it("leaves plain text char refs untouched outside URL contexts", () => {
        const input = "Temperature was 98.6&#176;F at the meeting.";
        expect(sanitizeSummaryHtml(input)).toBe(input);
      });
    });

    describe("idempotence for obfuscated payloads", () => {
      it("re-sanitizing a neutralized obfuscated payload is a no-op", () => {
        const dirty = '<a href="java&#x73;cript:alert(1)">x</a>';
        const once = sanitizeSummaryHtml(dirty);
        const twice = sanitizeSummaryHtml(once);
        expect(twice).toBe(once);
      });
    });
  });

  describe("URL-scheme obfuscation — named entities and unquoted attrs (M16)", () => {
    describe("named HTML character references in URL contexts", () => {
      it("neutralizes &colon; obfuscated javascript scheme in href", () => {
        const input = '<a href="javascript&colon;alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("alert(1)");
        expect(result).not.toContain("javascript&colon;");
      });

      it("neutralizes &Tab; obfuscated javascript scheme in href", () => {
        const input = '<a href="java&Tab;script:alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("alert(1)");
      });

      it("neutralizes lowercase &tab; variant", () => {
        const input = '<a href="java&tab;script:alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
      });

      it("neutralizes &NewLine; obfuscated scheme", () => {
        const input = '<a href="java&NewLine;script:alert(1)">x</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
      });

      it("neutralizes &colon; in single-quoted href", () => {
        const input = "<a href='javascript&colon;alert(1)'>x</a>";
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("alert(1)");
      });

      it("neutralizes &colon; in markdown link target", () => {
        const input = "[x](javascript&colon;alert(1))";
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("alert(1)");
        expect(result).toContain("[x](");
      });

      it("neutralizes unsafe data:text/html with &colon;", () => {
        const input = '<a href="data&colon;text/html,<b>x</b>">y</a>';
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toMatch(/data&colon;/);
        expect(result).not.toContain("data:text/html");
      });
    });

    describe("unquoted URL attribute values", () => {
      it("neutralizes unquoted href with numeric char ref", () => {
        const input = "<a href=java&#x73;cript:alert(1)>x</a>";
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
        expect(result).not.toContain("alert(1)");
      });

      it("neutralizes unquoted href with named &colon; entity", () => {
        const input = "<a href=javascript&colon;alert(1)>x</a>";
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:");
      });

      it("leaves benign unquoted http href untouched", () => {
        const input = "<a href=https://example.com>docs</a>";
        expect(sanitizeSummaryHtml(input)).toBe(input);
      });

      it("still handles literal javascript: in unquoted href via scheme pass", () => {
        // Literal (non-obfuscated) schemes fall through to the existing
        // JAVASCRIPT_SCHEME pass, which preserves the tail for diagnostic value.
        const input = "<a href=javascript:alert(1)>x</a>";
        const result = sanitizeSummaryHtml(input);
        expect(result).toContain("blocked:alert(1)");
        expect(result).not.toContain("javascript:");
      });
    });

    describe("benign named entities outside URL contexts are preserved", () => {
      it("leaves &colon; in plain body text untouched", () => {
        const input = "Agenda&colon; review KPIs and ship.";
        expect(sanitizeSummaryHtml(input)).toBe(input);
      });

      it("leaves &Tab; in plain body text untouched", () => {
        const input = "col1&Tab;col2&Tab;col3";
        expect(sanitizeSummaryHtml(input)).toBe(input);
      });

      it("leaves benign named entity (&amp;) in URL query untouched", () => {
        const input = '<a href="https://example.com?a=1&amp;b=2">x</a>';
        expect(sanitizeSummaryHtml(input)).toBe(input);
      });

      it("leaves unrecognized named entity (&nbsp;) untouched", () => {
        const input = "Hello&nbsp;world";
        expect(sanitizeSummaryHtml(input)).toBe(input);
      });

      it("leaves benign http link with &colon; in query string untouched", () => {
        // After normalization this is https://example.com?note=mailto:x
        // which starts with https — not dangerous, so no rewrite.
        const input = '<a href="https://example.com?note=mailto&colon;x">y</a>';
        expect(sanitizeSummaryHtml(input)).toBe(input);
      });
    });

    describe("idempotence for M16 payloads", () => {
      it("re-sanitizing a neutralized &colon; payload is a no-op", () => {
        const dirty = '<a href="javascript&colon;alert(1)">x</a>';
        const once = sanitizeSummaryHtml(dirty);
        const twice = sanitizeSummaryHtml(once);
        expect(twice).toBe(once);
      });

      it("re-sanitizing a neutralized unquoted payload is a no-op", () => {
        const dirty = "<a href=java&#x73;cript:alert(1)>x</a>";
        const once = sanitizeSummaryHtml(dirty);
        const twice = sanitizeSummaryHtml(once);
        expect(twice).toBe(once);
      });
    });
  });

  describe("idempotence", () => {
    it("sanitizing a sanitized malicious payload is a no-op", () => {
      const dirty =
        '# Hi\n<script>bad()</script>\n<a href="javascript:x()" onclick="y()">z</a>';
      const once = sanitizeSummaryHtml(dirty);
      const twice = sanitizeSummaryHtml(once);
      expect(twice).toBe(once);
    });

    it("sanitizing benign content twice is a no-op", () => {
      const benign = "# Meeting\n- action: ship it\n[docs](https://example.com)";
      const once = sanitizeSummaryHtml(benign);
      const twice = sanitizeSummaryHtml(once);
      expect(twice).toBe(once);
      expect(once).toBe(benign);
    });
  });
});
