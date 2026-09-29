import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HistoryIcon, PencilIcon, RefreshCwIcon, SearchIcon, TrashIcon } from "lucide-react";
import type { LearningEvent, MemoryItem, MemoryVersion } from "@elmatadore/api";
import { cn } from "cn";
import { dateTime } from "@/lib/format";
import { filterMemories, kindCounts } from "@/lib/memories";
import { useApi } from "@/app/api-context";
import { Empty } from "@/components/Empty";
import { Segmented } from "@/components/Segmented";
import { ViewHeader } from "@/components/shell/ViewHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CorrectDialog, ForgetDialog, HistoryDialog } from "@/features/memory/dialogs";
import { kindLabel } from "@/features/memory/labels";

type Tab = "items" | "timeline";

export default function MemoryView({ active }: { active: boolean }) {
  const api = useApi();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("items");
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<{ item: MemoryItem; versions: MemoryVersion[] } | null>(null);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [forgetting, setForgetting] = useState<MemoryItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, l] = await Promise.all([api.memories(), api.learnings()]);
      setItems(m.items);
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

  const counts = useMemo(() => kindCounts(items), [items]);
  const visible = useMemo(() => filterMemories(items, { kind, query }), [items, kind, query]);

  async function openHistory(item: MemoryItem) {
    try {
      setHistory({ item, versions: (await api.memoryVersions(item.id)).versions });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "não foi possível carregar o histórico");
    }
  }

  async function correct(item: MemoryItem, content: string, reason: string) {
    await api.correctMemory(item.id, content, reason || "corrigido no painel");
    toast.success("memória corrigida");
    setEditing(null);
    await load();
  }

  async function forget(item: MemoryItem, reason: string) {
    await api.memoryAction(item.id, "forget", reason || "esquecido no painel");
    setForgetting(null);
    await load();
    // A lista so traz ativas: o desfazer e o unico caminho de volta.
    toast.success("memória esquecida", {
      action: {
        label: "desfazer",
        onClick: () =>
          void api
            .memoryAction(item.id, "restore", "desfeito no painel")
            .then(load)
            .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "não foi possível restaurar")),
      },
    });
  }

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Memória" meta={`${items.length} ativas · ${events.length} eventos`}>
        <Segmented<Tab>
          label="Visão"
          value={tab}
          onChange={setTab}
          options={[
            { value: "items", label: "memórias" },
            { value: "timeline", label: "linha do tempo" },
          ]}
        />
        <Button variant="ghost" size="icon-sm" aria-label="Recarregar" onClick={() => void load()}>
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
        </Button>
      </ViewHeader>

      {tab === "items" ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <Segmented
              label="Tipo"
              value={kind}
              onChange={setKind}
              options={[{ value: "all", label: "todas", count: items.length }, ...counts.map(([k, n]) => ({ value: k, label: kindLabel(k), count: n }))]}
            />
            <div className="relative ml-auto w-full sm:w-64">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="buscar conteúdo, chave, pessoa" aria-label="Buscar memória" className="h-7 pl-7 font-mono text-xs" />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : visible.length === 0 ? (
              <Empty title={items.length === 0 ? "memória vazia" : "nada bate com o filtro"} hint={items.length === 0 ? "o que o grupo ensinar aparece aqui depois da consolidação." : undefined} />
            ) : (
              <ul className="divide-y">
                {visible.map((item) => (
                  <li key={item.id} className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-2.5 hover:bg-muted/30">
                    <div className="min-w-0">
                      <p className="leading-relaxed">{item.content}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.68rem] text-muted-foreground">
                        <Badge variant="default">{kindLabel(item.kind)}</Badge>
                        <span>{item.scope === "group" ? "grupo" : `pessoa ${item.user_id ?? "?"}`}</span>
                        <span className="truncate">{item.key}</span>
                        <span className="tabular">v{item.version}</span>
                        <span className="tabular">{dateTime(item.updated_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <Button variant="ghost" size="icon-sm" aria-label="Histórico" onClick={() => void openHistory(item)}>
                        <HistoryIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Corrigir" onClick={() => setEditing(item)}>
                        <PencilIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Esquecer" className="hover:text-destructive" onClick={() => setForgetting(item)}>
                        <TrashIcon />
                      </Button>
                    </div>
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
      <CorrectDialog item={editing} onClose={() => setEditing(null)} onSave={correct} />
      <ForgetDialog item={forgetting} onClose={() => setForgetting(null)} onConfirm={forget} />
    </div>
  );
}
