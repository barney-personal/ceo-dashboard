import { PageHeader } from "./page-header";
import { DataStateCard } from "./data-state-card";
import type { ResolvedDataState } from "@/lib/data/data-state";

const DEFAULT_PAGE_CONTAINER =
  "mx-auto min-w-0 max-w-7xl space-y-6 2xl:max-w-[96rem]";

export interface UnavailablePageProps {
  title: string;
  description: string;
  dataTitle: string;
  lastSyncedAt: Date | null;
  /** Override the default page container. Pass to keep the original layout. */
  containerClassName?: string;
}

/**
 * Full-page shell shown when every DB-backed loader for a page failed with
 * `DatabaseUnavailableError`. Replaces the page body with a single
 * `unavailable` DataStateCard so broken pages don't render ghost-empty
 * charts. Pages that gate on `pageState.kind === "unavailable"` use this.
 */
export function UnavailablePage({
  title,
  description,
  dataTitle,
  lastSyncedAt,
  containerClassName,
}: UnavailablePageProps) {
  return (
    <div className={containerClassName ?? DEFAULT_PAGE_CONTAINER}>
      <PageHeader title={title} description={description} />
      <DataStateCard
        variant="unavailable"
        title={dataTitle}
        lastSyncedAt={lastSyncedAt}
      />
    </div>
  );
}

export interface DataStateBannerProps {
  pageState: ResolvedDataState;
  title: string;
}

/**
 * Inline stale-data banner. Renders a `stale` DataStateCard iff the
 * resolved page state is stale, otherwise renders nothing. Pages drop this
 * above the body to surface "last synced X ago" without branching in JSX.
 */
export function DataStateBanner({ pageState, title }: DataStateBannerProps) {
  if (pageState.kind !== "stale") {
    return null;
  }
  return (
    <DataStateCard
      variant="stale"
      title={title}
      lastSyncedAt={pageState.lastSyncedAt}
    />
  );
}
