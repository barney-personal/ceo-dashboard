import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  recordEnpsPromptShown,
  shouldShowEnpsPrompt,
} from "@/lib/data/enps";

/**
 * Called once per session by the dashboard client modal provider.
 * If the user is due an eNPS prompt, records the show event and returns true.
 * The modal then renders; any dismissal is implicit and counted against the
 * monthly cap via the already-recorded show.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const show = await shouldShowEnpsPrompt(userId);
    if (show) {
      await recordEnpsPromptShown(userId);
    }
    return NextResponse.json({ show });
  } catch (err) {
    console.error("enps status failed", err);
    return NextResponse.json({ show: false });
  }
}
