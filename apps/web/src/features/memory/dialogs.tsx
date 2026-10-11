import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import type { MemoryBlock, MemoryBlockVersion } from "@elmatadore/api";
import { cn } from "cn";
import { dateTime } from "@/lib/format";
import { draftSize, entriesFromText, usageLevel } from "@/lib/memories";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const blockTitle = (block: MemoryBlock) => (block.scope === "group" ? "grupo" : block.name);

export function HistoryDialog({ value, onClose }: { value: { block: MemoryBlock; versions: MemoryBlockVersion[] } | null; onClose: () => void }) {
  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico · {value && blockTitle(value.block)}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{value?.block.owner_id}</DialogDescription>
        </DialogHeader>
        <ol className="relative flex flex-col gap-4 border-l pl-4">
          {[...(value?.versions ?? [])].reverse().map((v) => (
            <li key={v.version} className="relative">
              <span aria-hidden className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full border-2 border-background bg-primary" />
              <div className="flex items-center gap-3 font-mono text-[0.7rem] text-muted-foreground">
                <span className="text-primary">v{v.version}</span>
                <span className="tabular">{dateTime(v.created_at)}</span>
                {v.reason && <span className="truncate">· {v.reason}</span>}
              </div>
              {v.entries.length === 0 ? (
                <p className="mt-1 text-muted-foreground">(vazia)</p>
              ) : (
                <ul className="mt-1 list-disc pl-4 leading-relaxed">
                  {v.entries.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

export function EditDialog({
  block,
  onClose,
  onSave,
}: {
  block: MemoryBlock | null;
  onClose: () => void;
  onSave: (block: MemoryBlock, entries: string[], reason: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(block?.entries.join("\n") ?? "");
    setReason("");
  }, [block]);

  const entries = useMemo(() => entriesFromText(text), [text]);
  const size = draftSize(entries);
  const limit = block?.limit ?? 0;
  const level = usageLevel(size, limit);

  async function save() {
    if (!block) return;
    setBusy(true);
    try {
      await onSave(block, entries, reason.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "não foi possível salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={block !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar memória · {block && blockTitle(block)}</DialogTitle>
          <DialogDescription>Uma entrada por linha. Linha vazia some. O bot vê o bloco inteiro em toda conversa.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="memory-entries" className="label-mono">
                entradas
              </Label>
              <span className={cn("tabular font-mono text-[0.7rem]", level === "over" ? "text-destructive" : level === "high" ? "text-warning" : "text-muted-foreground")}>
                {size}/{limit}
              </span>
            </div>
            <Textarea id="memory-entries" value={text} onChange={(e) => setText(e.target.value)} rows={12} className="font-mono text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="memory-reason" className="label-mono">
              motivo
            </Label>
            <Input id="memory-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="editado pelo painel" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={busy || (level === "over" && size > draftSize(block?.entries ?? []))}>
            {busy && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
