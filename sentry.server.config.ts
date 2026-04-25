// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://b20d7c73b665f715d5c629addad2ec9b@o4511137405206528.ingest.us.sentry.io/4511184683270144",

  environment: process.env.NODE_ENV || "development",
  release: process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "local",

  // Only report from production deployments. Local `make dev` runs would
  // otherwise flood the prod Sentry with hot-reload glitches, stale Turbopack
  // chunks, and missing-migration errors from unmigrated local DBs. Opt in
  // locally by setting SENTRY_FORCE_ENABLE=true.
  enabled:
    process.env.NODE_ENV === "production" ||
    process.env.SENTRY_FORCE_ENABLE === "true",

  // Sample 10% of traces to avoid burning quota in production.
  tracesSampleRate: 0.1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // node:_http_server abortIncoming throws Error("aborted") when a client
  // disconnects mid-stream. The regex is anchored so it doesn't also swallow
  // the several intentional `"<X> request was aborted"` errors our integrations
  // emit for our own AbortController-driven cancellations.
  ignoreErrors: [/^aborted$/],
});
