import type { CallPoint } from "@/lib/metrics";
import { latency, time } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Uma barra por chamada, altura pela latencia; falha em vermelho. */
export function LatencyBars({ points }: { points: CallPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.latencyMs));
  return (
    <div className="flex h-28 items-end gap-px border-b border-dashed" role="img" aria-label={`Latência das últimas ${points.length} chamadas; máxima ${latency(max)}`}>
      {points.map((p) => (
        <Tooltip key={p.id}>
          <TooltipTrigger asChild>
            <span
              className={p.success ? "min-w-0.5 flex-1 rounded-t-[1px] bg-chart-1/80 hover:bg-chart-1" : "min-w-0.5 flex-1 rounded-t-[1px] bg-destructive/80 hover:bg-destructive"}
              style={{ height: `${Math.max(2, (p.latencyMs / max) * 100)}%` }}
            />
          </TooltipTrigger>
          <TooltipContent className="font-mono text-xs">
            {time(p.at)} · {latency(p.latencyMs)} · {p.success ? "ok" : "falha"}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
