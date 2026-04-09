"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Loader2, BookOpen } from "lucide-react";

interface Integration {
  provider: string;
  label: string;
  description: string;
  placeholder: string;
  connected: boolean;
  updatedAt: string | null;
}

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  granola: BookOpen,
};

interface SettingsIntegrationsProps {
  initialIntegrations: Integration[];
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [connected, setConnected] = useState(integration.connected);
  const [disconnecting, setDisconnecting] = useState(false);
  const Icon = PROVIDER_ICONS[integration.provider] ?? BookOpen;

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setStatus("saving");
    setErrorMessage("");

    try {
      const res = await fetch("/api/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: integration.provider, apiKey: apiKey.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrorMessage(data.error ?? "Failed to save");
        setStatus("error");
        return;
      }

      setStatus("success");
      setConnected(true);
      setApiKey("");
      setSuccessMessage("Connected — notes are syncing in the background");
      setTimeout(() => { setStatus("idle"); setSuccessMessage(""); }, 5000);
    } catch {
      setErrorMessage("Network error");
      setStatus("error");
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/integrations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: integration.provider }),
      });
      setConnected(false);
    } catch {
      // ignore
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {integration.label}
            </h3>
            <p className="text-xs text-muted-foreground">
              {integration.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <span className="flex items-center gap-1 text-xs text-positive">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
              </span>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                {disconnecting ? "..." : "Disconnect"}
              </button>
            </>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <XCircle className="h-3.5 w-3.5" />
              Not connected
            </span>
          )}
        </div>
      </div>

      {!connected && (
        <div className="px-5 py-4">
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (status === "error") setStatus("idle");
              }}
              placeholder={integration.placeholder}
              className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || status === "saving"}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                status === "saving"
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {status === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
              {status === "success" ? "Saved" : "Connect"}
            </button>
          </div>
          {status === "error" && (
            <p className="mt-1.5 text-xs text-destructive">{errorMessage}</p>
          )}
          {successMessage && (
            <p className="mt-1.5 text-xs text-positive">{successMessage}</p>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground/60">
            Add your <strong>personal</strong> API key: Open Granola &rarr; Settings &rarr; API &rarr; Create new key.
            This gives access to your own meeting notes. Don&apos;t use the enterprise key.
          </p>
        </div>
      )}
    </div>
  );
}

export function SettingsIntegrations({ initialIntegrations }: SettingsIntegrationsProps) {
  return (
    <div className="space-y-3">
      {initialIntegrations.map((integration) => (
        <IntegrationCard key={integration.provider} integration={integration} />
      ))}
    </div>
  );
}

export type { Integration };
