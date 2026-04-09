"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RouteErrorState } from "@/components/dashboard/route-error-state";

export default function RootError({
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
    <RouteErrorState
      title="This page failed to load"
      description="The app hit an unexpected error before the page could finish rendering. Retry the route to attempt a clean reload."
      digest={error.digest}
      onRetry={reset}
      fullScreen
    />
  );
}
