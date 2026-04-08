"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { RouteErrorState } from "@/components/dashboard/route-error-state";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <RouteErrorState
          title="The app hit a global failure"
          description="A root layout error interrupted the dashboard shell. Retry to reinitialize the app and request a fresh render."
          digest={error.digest}
          onRetry={reset}
          fullScreen
        />
      </body>
    </html>
  );
}
