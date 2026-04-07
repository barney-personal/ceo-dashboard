interface SectionDividerProps {
  title: string;
  subtitle: string;
  formula?: string;
}

export function SectionDivider({ title, subtitle, formula }: SectionDividerProps) {
  return (
    <div className="space-y-1 pt-2">
      <div className="h-px bg-border/50" />
      <h2 className="pt-2 font-display text-lg italic tracking-tight text-foreground">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
      {formula && (
        <p className="font-mono text-xs text-muted-foreground/70">{formula}</p>
      )}
    </div>
  );
}
