import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HistoryIcon, PencilIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import type { LearningEvent, MemoryBlock, MemoryBlockVersion } from "@elmatadore/api";
import { cn } from "cn";
import { dateTime } from "@/lib/format";
import { filterBlocks, usageLevel } from "@/lib/memories";
import { useApi } from "@/app/api-context";
import { Empty } from "@/components/Empty";
import { Segmented } from "@/components/Segmented";
import { ViewHeader } from "@/components/shell/ViewHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { blockTitle, EditDialog, HistoryDialog } from "@/features/memory/dialogs";

type Tab = "blocks" | "timeline";

function UsageBar({ size, limit }: { size: number; limit: number }) {
  const level = usageLevel(size, limit);
  const pct = limit > 0 ? Math.min(100, Math.round((size / limit) * 100)) : 0;
  return (
    <div className="flex items-center gap-2" title={`${size} de ${limit} caracteres`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={size} aria-label="Uso da memória">
        <div className={cn("h-full rounded-full", level === "over" ? "bg-destructive" : level === "high" ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular">
        {size}/{limit}
      </span>
    </div>
  );
}

export default function MemoryView({ active }: { active: boolean }) {
  const api = useApi();
  const [blocks, setBlocks] = useState<MemoryBlock[]>([]);
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("blocks");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<{ block: MemoryBlock; versions: MemoryBlockVersion[] } | null>(null);
  const [editing, setEditing] = useState<MemoryBlock | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, l] = await Promise.all([api.memories(), api.learnings()]);
      setBlocks(m.blocks);
      setEvents(l.events);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "não foi possível carregar");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const visible = useMemo(() => filterBlocks(blocks, query), [blocks, query]);

  async function openHistory(block: MemoryBlock) {
    try {
      setHistory({ block, versions: (await api.memoryVersions(block.scope, block.owner_id)).versions });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "não foi possível carregar o histórico");
    }
  }

  async function save(block: MemoryBlock, entries: string[], reason: string) {
    await api.saveMemory(block.scope, block.owner_id, entries, reason || "editado pelo painel");
    toast.success("memória salva");
    setEditing(null);
    await load();
  }

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Memória" meta={`${blocks.length} blocos · ${events.length} eventos`}>
        <Segmented<Tab>
          label="Visão"
          value={tab}
          onChange={setTab}
          options={[
            { value: "blocks", label: "blocos" },
            { value: "timeline", label: "linha do tempo" },
          ]}
        />
        <Button variant="ghost" size="icon-sm" aria-label="Recarregar" onClick={() => void load()}>
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
        </Button>
      </ViewHeader>

      {tab === "blocks" ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <div className="relative ml-auto w-full sm:w-64">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="buscar pessoa ou entrada" aria-label="Buscar memória" className="h-7 pl-7 font-mono text-xs" />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && blocks.length === 0 ? (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : visible.length === 0 ? (
              <Empty
                title={blocks.length === 0 ? "memória vazia" : "nada bate com a busca"}
                hint={blocks.length === 0 ? "o bot escreve aqui pela tool memory ou pela revisão em segundo plano." : undefined}
              />
            ) : (
              <ul className="divide-y">
                {visible.map((block) => (
                  <li key={`${block.scope}:${block.owner_id}`} className="group px-4 py-3 hover:bg-muted/30">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.68rem] text-muted-foreground">
                      <Badge variant="default">{block.scope === "group" ? "grupo" : "pessoa"}</Badge>
                      <span className="font-sans text-sm text-foreground">{blockTitle(block)}</span>
                      <span className="truncate">{block.owner_id}</span>
                      <UsageBar size={block.size} limit={block.limit} />
                      <span className="tabular">{dateTime(block.updated_at)}</span>
                      <span className="ml-auto flex gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button variant="ghost" size="icon-sm" aria-label="Histórico" onClick={() => void openHistory(block)}>
                          <HistoryIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Editar" onClick={() => setEditing(block)}>
                          <PencilIcon />
                        </Button>
                      </span>
                    </div>
                    {block.entries.length === 0 ? (
                      <p className="mt-1.5 text-muted-foreground">(vazia)</p>
                    ) : (
                      <ul className="mt-1.5 list-disc pl-5 leading-relaxed">
                        {block.entries.map((e, i) => (
                          <li key={i} className="break-words">
                            {e}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {events.length === 0 ? (
            <Empty title="nenhum evento ainda" />
          ) : (
            <ol className="divide-y font-mono text-xs">
              {events.map((event, i) => (
                <li key={`${event.at}-${i}`} className="grid grid-cols-[7.5rem_4.5rem_minmax(0,1fr)] gap-x-3 px-4 py-2 hover:bg-muted/30">
                  <span className="tabular text-muted-foreground">{dateTime(event.at)}</span>
                  <span className={event.kind === "skill" ? "text-info" : "text-primary"}>{event.kind === "skill" ? "skill" : "memória"}</span>
                  <span className="min-w-0">
                    <span className="text-foreground">{event.subject}</span>
                    <span className="block font-sans text-[0.92rem] break-words text-muted-foreground">{event.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <HistoryDialog value={history} onClose={() => setHistory(null)} />
      <EditDialog block={editing} onClose={() => setEditing(null)} onSave={save} />
    </div>
  );
}
