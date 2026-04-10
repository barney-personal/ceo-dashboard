"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function PageViewTracker() {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;

    // Skip if we just tracked this exact path (handles strict-mode double-fire)
    if (lastTracked.current === pathname) return;
    lastTracked.current = pathname;

    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {
      // Silently swallow — tracking is best-effort
    });
  }, [pathname]);

  return null;
}
