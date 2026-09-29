import { BrainIcon, ChartNoAxesColumnIcon, LogOutIcon, MessageSquareIcon, SlidersHorizontalIcon, TerminalIcon } from "lucide-react";
import { cn } from "cn";
import { VIEWS, VIEW_LABEL, type View } from "@/lib/nav";
import { Kbd } from "@/components/Kbd";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

const ICON: Record<View, typeof BrainIcon> = {
  chat: MessageSquareIcon,
  memory: BrainIcon,
  logs: TerminalIcon,
  metrics: ChartNoAxesColumnIcon,
  config: SlidersHorizontalIcon,
};

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="grid size-6 place-items-center rounded-sm bg-primary font-mono text-xs font-bold text-primary-foreground">
        em
      </span>
      <span className="font-mono text-sm font-semibold tracking-tight">
        elmatadore<span className="text-primary">_</span>
      </span>
    </div>
  );
}

/** Navegacao principal. No mobile vive dentro de um Sheet. */
export function Rail({ view, onNavigate, onLogout }: { view: View; onNavigate: (view: View) => void; onLogout: () => void }) {
  return (
    <div className="flex h-full w-52 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center border-b px-4">
        <Wordmark />
      </div>

      <nav aria-label="Seções" className="flex flex-col gap-px p-2">
        <span className="label-mono px-2 pt-1 pb-1.5">painel</span>
        {VIEWS.map((id, i) => {
          const Icon = ICON[id];
          const active = view === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-8 items-center gap-2.5 rounded-sm px-2 text-left transition-colors",
                active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />}
              <Icon className={cn("size-4", active && "text-primary")} />
              <span className="flex-1">{VIEW_LABEL[id]}</span>
              <Kbd className="opacity-0 transition-opacity group-hover:opacity-100">{i + 1}</Kbd>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-1 border-t p-2">
        <span className="label-mono flex-1 px-2">alt + 1..5</span>
        <ThemeToggle />
        <Button variant="ghost" size="icon-sm" aria-label="Sair" onClick={onLogout}>
          <LogOutIcon />
        </Button>
      </div>
    </div>
  );
}
