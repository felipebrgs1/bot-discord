import type { Meta } from "@elmatadore/api";
import { cn } from "cn";
import { useOnline } from "@/hooks/use-online";

/** Rodape de console: conexao, modelo e papel do painel. */
export function StatusBar({ meta }: { meta: Meta | null }) {
  const online = useOnline();
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t bg-sidebar px-3 font-mono text-[0.68rem] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className={cn("size-1.5 rounded-full", online ? "bg-success" : "animate-pulse bg-destructive")} />
        {online ? "online" : "offline"}
      </span>
      <span className="truncate" title={meta?.model}>
        modelo <span className="text-foreground">{meta?.model ?? "…"}</span>
      </span>
      <span className="ml-auto">
        papel <span className={cn(meta?.role === "admin" ? "text-primary" : "text-foreground")}>{meta?.role ?? "…"}</span>
      </span>
    </footer>
  );
}
