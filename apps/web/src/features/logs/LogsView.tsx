import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon, EraserIcon, PauseIcon, PlayIcon, SearchIcon } from "lucide-react";
import type { LogEntry, LogLevel } from "@elmatadore/api";
import { cn } from "cn";
import { time } from "@/lib/format";
import { appendLogs, filterLogs, formatAttr, type LevelFilter } from "@/lib/logs";
import { useApi } from "@/app/api-context";
import { usePolling } from "@/hooks/use-polling";
import { Empty } from "@/components/Empty";
import { Segmented } from "@/components/Segmented";
import { ViewHeader } from "@/components/shell/ViewHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BUFFER = 3000;
const POLL_MS = 2000;

const LEVEL_TONE: Record<LogLevel, string> = {
  debug: "text-muted-foreground/70",
  info: "text-info",
  warn: "text-warning",
  error: "text-destructive",
};

export default function LogsView({ active }: { active: boolean }) {
  const api = useApi();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [follow, setFollow] = useState(true);
  const cursorRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tick = useCallback(async () => {
    try {
      const page = await api.logs(cursorRef.current);
      cursorRef.current = page.next;
      if (page.entries.length) setEntries((prev) => appendLogs(prev, page.entries, BUFFER));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao ler logs");
    }
  }, [api]);

  usePolling(tick, POLL_MS, active && !paused);

  const visible = useMemo(() => filterLogs(entries, { level, query }), [entries, level, query]);
  const counts = useMemo(() => {
    const c: Record<LevelFilter, number> = { all: entries.length, debug: 0, info: 0, warn: 0, error: 0 };
    for (const e of entries) c[e.level]++;
    return c;
  }, [entries]);

  useEffect(() => {
    const el = scrollRef.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [visible.length, follow]);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title="Logs"
        meta={
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-1.5 rounded-full", paused ? "bg-muted-foreground" : error ? "bg-destructive" : "animate-pulse bg-success")} />
            {paused ? "pausado" : error ? error : `ao vivo · ${entries.length} no buffer`}
          </span>
        }
      >
        <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>
          {paused ? <PlayIcon /> : <PauseIcon />}
          {paused ? "seguir" : "pausar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEntries([])}>
          <EraserIcon /> limpar
        </Button>
      </ViewHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Segmented<LevelFilter>
          label="Nível"
          value={level}
          onChange={setLevel}
          options={(["all", "debug", "info", "warn", "error"] as const).map((l) => ({ value: l, label: l === "all" ? "todos" : l, count: counts[l] }))}
        />
        <div className="relative ml-auto w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filtrar texto e atributos" aria-label="Filtrar logs" className="h-7 pl-7 font-mono text-xs" />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto bg-sidebar/50 py-1 font-mono text-[0.78rem] leading-5"
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
        >
          {entries.length === 0 ? (
            <Empty title={paused ? "pausado" : "aguardando eventos"} />
          ) : visible.length === 0 ? (
            <Empty title="nenhum log bate com o filtro" />
          ) : (
            visible.map((entry) => <LogRow key={entry.id} entry={entry} />)
          )}
        </div>
        {!follow && (
          <Button
            size="sm"
            variant="outline"
            className="absolute right-4 bottom-3 bg-background"
            onClick={() => {
              setFollow(true);
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            <ArrowDownIcon /> fim
          </Button>
        )}
      </div>
    </div>
  );
}

// Hora e nivel em colunas fixas; mensagem na coluna flexivel (minmax(0,1fr)
// impede estourar a tela); atributos quebram na linha de baixo.
function LogRow({ entry }: { entry: LogEntry }) {
  const attrs = Object.entries(entry.attrs ?? {});
  return (
    <div className="grid grid-cols-[4.5rem_3rem_minmax(0,1fr)] gap-x-3 px-4 hover:bg-accent/40">
      <span className="tabular text-muted-foreground">{time(entry.time)}</span>
      <span className={cn("uppercase", LEVEL_TONE[entry.level])}>{entry.level}</span>
      <span className={cn("break-words", entry.level === "error" && "text-destructive")}>{entry.msg}</span>
      {attrs.length > 0 && (
        <div className="col-start-3 flex flex-wrap gap-x-3 text-[0.72rem] text-muted-foreground">
          {attrs.map(([key, value]) => (
            <span key={key} className="break-all">
              <span className="text-foreground/70">{key}</span>={formatAttr(value)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
