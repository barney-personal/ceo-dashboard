import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export function SectionCard({
  title,
  description,
  children,
  className,
  action,
}: SectionCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card shadow-warm",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
