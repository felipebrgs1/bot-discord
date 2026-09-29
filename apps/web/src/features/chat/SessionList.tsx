import { useMemo, useState } from "react";
import { PlusIcon, TrashIcon } from "lucide-react";
import type { ChatSession } from "@elmatadore/api";
import { cn } from "cn";
import { groupSessions } from "@/lib/sessions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  sessions: ChatSession[];
  current: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function SessionList({ sessions, current, onOpen, onNew, onDelete }: Props) {
  const [confirm, setConfirm] = useState<ChatSession | null>(null);
  // Agrupamento relativo a agora: recalcula quando a lista muda.
  const groups = useMemo(() => groupSessions(sessions, new Date()), [sessions]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 items-center justify-between border-b px-3">
        <span className="label-mono">sessões · {sessions.length}</span>
        <Button size="xs" variant="outline" onClick={onNew}>
          <PlusIcon /> nova
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {groups.length === 0 && <p className="px-2 py-3 font-mono text-xs text-muted-foreground">nenhuma sessão ainda</p>}
        {groups.map((group) => (
          <section key={group.label} className="mb-2">
            <h3 className="label-mono px-2 pt-2 pb-1 text-[0.64rem]">{group.label}</h3>
            {group.items.map((s) => (
              <div key={s.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(s.id)}
                  title={s.title}
                  aria-current={current === s.id ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-left transition-colors",
                    current === s.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{s.title || "sem título"}</span>
                  <span className="tabular font-mono text-[0.65rem] text-muted-foreground group-hover:opacity-0">{s.messages}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-1 right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  aria-label={`Excluir ${s.title || "sessão sem título"}`}
                  onClick={() => setConfirm(s)}
                >
                  <TrashIcon />
                </Button>
              </div>
            ))}
          </section>
        ))}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta sessão?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirm?.title || "sem título"}" e as mensagens dela saem do histórico. O que já foi consolidado na memória continua.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirm) onDelete(confirm.id);
                setConfirm(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
