import type { ReactNode } from "react";
import { cn } from "cn";

export type Tone = "default" | "primary" | "success" | "warning" | "destructive";

const TONE: Record<Tone, string> = {
  default: "text-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

/** Numero grande com rotulo mono; usado na faixa de metricas. */
export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <span className="label-mono">{label}</span>
      <span className={cn("tabular truncate font-mono text-xl font-medium", TONE[tone])}>{value}</span>
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
