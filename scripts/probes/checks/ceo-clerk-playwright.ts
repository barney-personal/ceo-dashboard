import { mkdirSync } from "fs";
import type { CheckContext, CheckHandler } from "../../probe";
import type { CheckResult } from "../report";

interface ScreenshotMeta {
  path?: string;
  error?: string;
}

async function captureScreenshot(
  page: { screenshot: (opts: { path: string; fullPage: boolean }) => Promise<Buffer> },
  dir: string,
): Promise<ScreenshotMeta> {
  try {
    mkdirSync(dir, { recursive: true });
    const path = `${dir}/playwright-failure-${Date.now()}.png`;
    await page.screenshot({ path, fullPage: true });
    return { path };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export const run: CheckHandler = async (ctx: CheckContext): Promise<CheckResult> => {
  const checkName = "ceo-clerk-playwright";
  const start = performance.now();

  const clerkTestToken = process.env.CLERK_TEST_TOKEN;
  const canaryExpected = process.env.CANARY_EXPECTED_VALUE || "ceo-dashboard-canary-ok";
  const screenshotDir = process.env.PROBE_SCREENSHOT_DIR || ".probe-reports";

  if (!clerkTestToken) {
    return {
      checkName,
      status: "red",
      latencyMs: Math.round(performance.now() - start),
      error: "CLERK_TEST_TOKEN not configured — skipping browser probe",
      details: { skipped: true, reason: "missing config" },
    };
  }

  let browser: { close: () => Promise<void> } | null = null;
  let page: {
    goto: (url: string, opts: Record<string, unknown>) => Promise<void>;
    locator: (selector: string) => { textContent: (opts: Record<string, unknown>) => Promise<string | null> };
    screenshot: (opts: { path: string; fullPage: boolean }) => Promise<Buffer>;
  } | null = null;

  try {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true });
    // Playwright's Browser type is narrower than what we need; we only use
    // a handful of methods on the context and page. Cast via `unknown` to
    // keep lint happy without pulling @playwright/test types into a lib build.
    const context = await (
      browser as unknown as {
        newContext: () => Promise<{
          addCookies: (cookies: Array<{ name: string; value: string; domain: string; path: string }>) => Promise<void>;
          newPage: () => Promise<typeof page>;
        }>;
      }
    ).newContext();

    const url = new URL(ctx.baseUrl);
    await context.addCookies([
      {
        name: "__clerk_testing_token",
        value: clerkTestToken,
        domain: url.hostname,
        path: "/",
      },
    ]);

    page = await context.newPage();
    await page!.goto(`${ctx.baseUrl}/dashboard`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    const canary = page!.locator('[data-testid="probe-canary"]');
    const canaryText = await canary.textContent({ timeout: 10000 });
    const latencyMs = Math.round(performance.now() - start);

    if (canaryText !== canaryExpected) {
      const screenshot = await captureScreenshot(page!, screenshotDir);
      return {
        checkName,
        status: "red",
        latencyMs,
        error: `canary mismatch: expected "${canaryExpected}", got "${canaryText}"`,
        details: { canaryExpected, canaryActual: canaryText, screenshot },
      };
    }

    return {
      checkName,
      status: "green",
      latencyMs,
      details: { canaryValue: canaryText },
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const screenshot = page ? await captureScreenshot(page, screenshotDir) : undefined;
    return {
      checkName,
      status: "red",
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
      details: screenshot ? { screenshot } : undefined,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};
