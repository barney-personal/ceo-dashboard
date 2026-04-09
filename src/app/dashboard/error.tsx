"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RouteErrorState } from "@/components/dashboard/route-error-state";

export default function DashboardError({
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
      title="This dashboard section failed to load"
      description="Something went wrong while loading this route. Retry the view to request fresh data and restore the dashboard."
      digest={error.digest}
      onRetry={reset}
      className="mx-auto max-w-5xl py-12"
    />
  );
}
