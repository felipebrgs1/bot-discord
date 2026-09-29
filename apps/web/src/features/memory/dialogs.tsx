import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import type { MemoryItem, MemoryVersion } from "@elmatadore/api";
import { dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function HistoryDialog({ value, onClose }: { value: { item: MemoryItem; versions: MemoryVersion[] } | null; onClose: () => void }) {
  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico</DialogTitle>
          <DialogDescription className="font-mono text-xs">{value?.item.key}</DialogDescription>
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
              <p className="mt-1 leading-relaxed">{v.content}</p>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

/** Estado do formulario vive aqui; a acao so volta quando deu certo. */
function useSubmit<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const run = async (...args: A) => {
    setBusy(true);
    try {
      await action(...args);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "não foi possível aplicar");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function CorrectDialog({
  item,
  onClose,
  onSave,
}: {
  item: MemoryItem | null;
  onClose: () => void;
  onSave: (item: MemoryItem, content: string, reason: string) => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [reason, setReason] = useState("");
  const { busy, run } = useSubmit(onSave);

  useEffect(() => {
    setContent(item?.content ?? "");
    setReason("");
  }, [item]);

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Corrigir memória</DialogTitle>
          <DialogDescription>Gera uma versão nova e reativa a memória.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="fix-content" className="label-mono">
              conteúdo
            </Label>
            <Textarea id="fix-content" value={content} onChange={(e) => setContent(e.target.value)} rows={4} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fix-reason" className="label-mono">
              motivo
            </Label>
            <Input id="fix-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="corrigido no painel" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => item && void run(item, content, reason.trim())} disabled={busy || !content.trim()}>
            {busy && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ForgetDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: MemoryItem | null;
  onClose: () => void;
  onConfirm: (item: MemoryItem, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const { busy, run } = useSubmit(onConfirm);

  useEffect(() => setReason(""), [item]);

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Esquecer memória?</DialogTitle>
          <DialogDescription>Sai da recuperação; reextrações do mesmo conteúdo são descartadas.</DialogDescription>
        </DialogHeader>
        <p className="rounded-md border bg-muted/30 p-2.5 text-sm">{item?.content}</p>
        <div className="grid gap-1.5">
          <Label htmlFor="forget-reason" className="label-mono">
            motivo (opcional)
          </Label>
          <Input id="forget-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="esquecido no painel" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => item && void run(item, reason.trim())} disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />} Esquecer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
