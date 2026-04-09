import { auth } from "@clerk/nextjs/server";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  SettingsIntegrations,
  type Integration,
} from "@/components/dashboard/settings-integrations";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { BookOpen } from "lucide-react";

export default async function SettingsPage() {
  const { userId } = await auth();

  const rows = userId
    ? await db
        .select({ provider: userIntegrations.provider, updatedAt: userIntegrations.updatedAt })
        .from(userIntegrations)
        .where(eq(userIntegrations.clerkUserId, userId))
    : [];

  const connectedProviders = new Map(
    rows.map((r) => [r.provider, r.updatedAt.toISOString()])
  );

  const integrations: Integration[] = [
    {
      provider: "granola",
      label: "Granola",
      description: "AI meeting notes — summaries, transcripts, and action items",
      placeholder: "grn_...",
      icon: BookOpen,
      connected: connectedProviders.has("granola"),
      updatedAt: connectedProviders.get("granola") ?? null,
    },
  ];

  return (
    <div className="mx-auto min-w-0 max-w-3xl space-y-8">
      <PageHeader
        title="Settings"
        description="Manage your integrations and preferences"
      />

      <div className="space-y-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
          Connected Integrations
        </h3>
        <SettingsIntegrations initialIntegrations={integrations} />
      </div>
    </div>
  );
}
