// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://b20d7c73b665f715d5c629addad2ec9b@o4511137405206528.ingest.us.sentry.io/4511184683270144",

  environment: process.env.NODE_ENV || "development",
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || "local",

  // Prod-only by default — avoids local dev hot-reload errors (stale Turbopack
  // chunks, transient compile failures, missing-migration DB errors) flooding
  // the prod Sentry. Opt in locally with NEXT_PUBLIC_SENTRY_FORCE_ENABLE=true.
  enabled:
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_SENTRY_FORCE_ENABLE === "true",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Sample 10% of traces to avoid burning quota in production.
  tracesSampleRate: 0.1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
