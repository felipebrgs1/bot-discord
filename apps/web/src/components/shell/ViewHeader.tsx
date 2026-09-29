import type { ReactNode } from "react";

/** Cabecalho de cada tela: titulo, linha de contexto em mono e acoes. */
export function ViewHeader({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="text-[1.05rem] font-semibold tracking-tight">{title}</h1>
        {meta && <span className="truncate font-mono text-xs text-muted-foreground">{meta}</span>}
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
