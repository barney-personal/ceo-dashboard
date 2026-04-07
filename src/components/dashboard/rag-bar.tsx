import { cn } from "@/lib/utils";

interface RagBarProps {
  green: number;
  amber: number;
  red: number;
  grey?: number;
  className?: string;
}

export function RagBar({ green, amber, red, grey = 0, className }: RagBarProps) {
  const total = green + amber + red + grey;
  if (total === 0) return null;

  const pct = (v: number) => `${(v / total) * 100}%`;

  return (
    <div className={cn("flex h-2 overflow-hidden rounded-full bg-muted/50 gap-px", className)}>
      {green > 0 && (
        <div className="bg-positive rounded-full transition-all duration-500" style={{ width: pct(green) }} />
      )}
      {amber > 0 && (
        <div className="bg-warning rounded-full transition-all duration-500" style={{ width: pct(amber) }} />
      )}
      {red > 0 && (
        <div className="bg-negative rounded-full transition-all duration-500" style={{ width: pct(red) }} />
      )}
      {grey > 0 && (
        <div className="bg-muted-foreground/30 rounded-full transition-all duration-500" style={{ width: pct(grey) }} />
      )}
    </div>
  );
}
