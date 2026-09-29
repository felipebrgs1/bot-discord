import { useCallback, useMemo, useState } from "react";
import { PauseIcon, PlayIcon } from "lucide-react";
import type { MetricsSnapshot } from "@elmatadore/api";
import { cn } from "cn";
import { compact, latency, money, num, percent, time } from "@/lib/format";
import { cacheShare, callSeries, failureRate, tokensPerSecond } from "@/lib/metrics";
import { useApi } from "@/app/api-context";
import { usePolling } from "@/hooks/use-polling";
import { Empty } from "@/components/Empty";
import { Stat } from "@/components/Stat";
import { ViewHeader } from "@/components/shell/ViewHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LatencyBars } from "@/features/metrics/LatencyBars";

const DEFAULT_REFRESH = 5000;

export default function MetricsView({ active }: { active: boolean }) {
  const api = useApi();
  const [data, setData] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [updated, setUpdated] = useState("");

  const tick = useCallback(async () => {
    try {
      setData(await api.metrics());
      setUpdated(time(new Date().toISOString()));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao ler métricas");
    }
  }, [api]);

  usePolling(tick, data?.refresh_ms ?? DEFAULT_REFRESH, active && !paused);

  const series = useMemo(() => callSeries(data?.recent ?? []), [data]);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Métricas" meta={error ? <span className="text-destructive">{error}</span> : paused ? "pausado" : updated ? `atualizado ${updated}` : "carregando"}>
        <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>
          {paused ? <PlayIcon /> : <PauseIcon />}
          {paused ? "seguir" : "pausar"}
        </Button>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!data ? (
          <div className="grid gap-3 p-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : data.summary.requests === 0 ? (
          <Empty title="nenhuma chamada registrada" hint="as métricas aparecem depois da primeira resposta do bot." />
        ) : (
          <>
            <section aria-label="Resumo" className="grid grid-cols-2 divide-x divide-y border-b sm:grid-cols-3 sm:divide-y-0 xl:grid-cols-6">
              <Stat label="chamadas" value={num(data.summary.requests)} />
              <Stat
                label="falhas"
                value={percent(failureRate(data.summary))}
                hint={`${num(data.summary.failures)} de ${num(data.summary.requests)}`}
                tone={data.summary.failures > 0 ? "destructive" : "success"}
              />
              <Stat label="entrada" value={compact(data.summary.input_tokens)} hint="tokens" />
              <Stat label="saída" value={compact(data.summary.output_tokens)} hint="tokens" />
              <Stat label="cache" value={percent(cacheShare(data.summary))} hint={`${compact(data.summary.cached_tokens)} lidos`} tone="primary" />
              <Stat label="custo" value={money(data.summary.cost_usd)} />
            </section>

            <section className="border-b px-4 py-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="label-mono">latência · últimas {series.length} chamadas</h2>
                <span className="flex items-center gap-3 font-mono text-[0.68rem] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-[1px] bg-chart-1" /> ok
                  </span>
                  <span className="flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-[1px] bg-destructive" /> falha
                  </span>
                </span>
              </div>
              <LatencyBars points={series} />
            </section>

            <section className="border-b">
              <h2 className="label-mono px-4 pt-4 pb-2">por modelo</h2>
              <Table className="font-mono text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">modelo</TableHead>
                    <TableHead>operação</TableHead>
                    <TableHead>origem</TableHead>
                    <TableHead className="text-right">chamadas</TableHead>
                    <TableHead className="text-right">falhas</TableHead>
                    <TableHead className="text-right">latência média</TableHead>
                    <TableHead className="text-right">tokens</TableHead>
                    <TableHead className="pr-4 text-right">custo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.models.map((m) => (
                    <TableRow key={`${m.provider}/${m.model}/${m.operation}/${m.source}`}>
                      <TableCell className="pl-4">
                        <span className="text-muted-foreground">{m.provider}/</span>
                        {m.model}
                      </TableCell>
                      <TableCell>{m.operation}</TableCell>
                      <TableCell>{m.source}</TableCell>
                      <TableCell className="tabular text-right">{num(m.requests)}</TableCell>
                      <TableCell className={cn("tabular text-right", m.failures > 0 && "text-destructive")}>{num(m.failures)}</TableCell>
                      <TableCell className="tabular text-right">{latency(m.avg_latency_ms)}</TableCell>
                      <TableCell className="tabular text-right">{compact(m.input_tokens + m.output_tokens)}</TableCell>
                      <TableCell className="tabular pr-4 text-right">{money(m.cost_usd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            <section>
              <h2 className="label-mono px-4 pt-4 pb-2">chamadas recentes</h2>
              <Table className="font-mono text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">hora</TableHead>
                    <TableHead>status</TableHead>
                    <TableHead>modelo</TableHead>
                    <TableHead>operação</TableHead>
                    <TableHead className="text-right">duração</TableHead>
                    <TableHead className="text-right">entrada</TableHead>
                    <TableHead className="text-right">saída</TableHead>
                    <TableHead className="text-right">tok/s</TableHead>
                    <TableHead className="pr-4 text-right">custo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent.map((c) => {
                    const tps = tokensPerSecond(c);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="tabular pl-4 text-muted-foreground">{time(c.started_at)}</TableCell>
                        <TableCell className={c.success ? "text-success" : "text-destructive"}>{c.success ? "ok" : "falha"}</TableCell>
                        <TableCell>{c.model}</TableCell>
                        <TableCell>
                          {c.operation} <span className="text-muted-foreground">· {c.source}</span>
                        </TableCell>
                        <TableCell className="tabular text-right">{latency(c.duration_ms)}</TableCell>
                        <TableCell className="tabular text-right">{num(c.input_tokens)}</TableCell>
                        <TableCell className="tabular text-right">{num(c.output_tokens)}</TableCell>
                        <TableCell className="tabular text-right">{tps === null ? "—" : tps.toFixed(1)}</TableCell>
                        <TableCell className="tabular pr-4 text-right">{money(c.cost_usd)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
