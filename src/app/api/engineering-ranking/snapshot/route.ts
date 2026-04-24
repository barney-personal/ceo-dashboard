import { NextResponse, type NextRequest } from "next/server";
import { requireRole, authErrorResponse } from "@/lib/sync/request-auth";
import {
  getEngineeringRankingSnapshotWithSignals,
  listRankingSnapshotSlices,
  persistRankingSnapshot,
  readRankingSnapshot,
} from "@/lib/data/engineering-ranking.server";
import { RANKING_METHODOLOGY_VERSION } from "@/lib/data/engineering-ranking";

const SNAPSHOT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(_request: NextRequest) {
  const auth = await requireRole("ceo");
  const authError = authErrorResponse(auth);
  if (authError) return authError;

  // Must persist with the same signal rows the snapshot was built from so each
  // persisted row carries a non-null `input_hash`. Passing only the snapshot
  // would null out the hash and make M18 movers blind to input drift.
  const { snapshot, signals } =
    await getEngineeringRankingSnapshotWithSignals();
  const { rowsWritten, snapshotDate } = await persistRankingSnapshot(snapshot, {
    signals,
  });

  return NextResponse.json({
    snapshotDate,
    methodologyVersion: snapshot.methodologyVersion,
    rowsWritten,
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireRole("ceo");
  const authError = authErrorResponse(auth);
  if (authError) return authError;

  const snapshotDate = request.nextUrl.searchParams.get("date");
  const methodologyVersion =
    request.nextUrl.searchParams.get("version") ?? RANKING_METHODOLOGY_VERSION;

  if (!snapshotDate) {
    const slices = await listRankingSnapshotSlices();
    return NextResponse.json({ slices });
  }

  // Reject anything that doesn't look like `YYYY-MM-DD` with a 400 so a
  // client-side typo doesn't silently get confused for "no data on that
  // day". The read path uses parameterised queries, so this check is for
  // message quality, not injection defence.
  if (!SNAPSHOT_DATE_RE.test(snapshotDate)) {
    return NextResponse.json(
      {
        error: "invalid `date` query parameter — expected YYYY-MM-DD",
        received: snapshotDate,
      },
      { status: 400 },
    );
  }

  const rows = await readRankingSnapshot({ snapshotDate, methodologyVersion });
  return NextResponse.json({ snapshotDate, methodologyVersion, rows });
}
