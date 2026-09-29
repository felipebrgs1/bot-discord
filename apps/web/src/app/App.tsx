import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2Icon, MenuIcon } from "lucide-react";
import type { Meta } from "@elmatadore/api";
import { createApi } from "@/lib/api/client";
import type { View } from "@/lib/nav";
import { useHashView } from "@/hooks/use-hash-view";
import { useViewHotkeys } from "@/hooks/use-view-hotkeys";
import { ApiProvider, useApi } from "@/app/api-context";
import { LoginScreen } from "@/app/LoginScreen";
import { Rail, Wordmark } from "@/components/shell/Rail";
import { StatusBar } from "@/components/shell/StatusBar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ChatView } from "@/features/chat/ChatView";

// Telas de ops em chunks proprios: a conversa pinta sem esperar esse codigo.
const MemoryView = lazy(() => import("@/features/memory/MemoryView"));
const LogsView = lazy(() => import("@/features/logs/LogsView"));
const MetricsView = lazy(() => import("@/features/metrics/MetricsView"));
const ConfigView = lazy(() => import("@/features/config/ConfigView"));

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const api = useMemo(
    () => createApi({ fetch: (url, init) => window.fetch(url, init), onUnauthorized: () => setAuthed(false) }),
    [],
  );

  useEffect(() => {
    api
      .session()
      .then(setAuthed)
      .catch(() => setAuthed(false));
  }, [api]);

  return (
    <ApiProvider api={api}>
      {authed === null ? (
        <div className="grid h-dvh place-items-center">
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : authed ? (
        <Shell onLogout={() => void api.logout().finally(() => setAuthed(false))} />
      ) : (
        <LoginScreen onDone={() => setAuthed(true)} />
      )}
    </ApiProvider>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useHashView();
  const [navOpen, setNavOpen] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const api = useApi();

  useEffect(() => {
    api.meta().then(setMeta).catch(() => setMeta(null));
  }, [api]);

  const navigate = useCallback(
    (next: View) => {
      setView(next);
      setNavOpen(false);
    },
    [setView],
  );
  useViewHotkeys(navigate);

  const rail = <Rail view={view} onNavigate={navigate} onLogout={onLogout} />;

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <aside className="hidden md:flex">{rail}</aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 items-center gap-2 border-b px-2 md:hidden">
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Abrir menu">
                  <MenuIcon />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-52 gap-0 border-0 p-0">
                <SheetTitle className="sr-only">Navegação</SheetTitle>
                {rail}
              </SheetContent>
            </Sheet>
            <Wordmark />
          </div>

          {/* Telas ficam montadas: trocar de aba nao corta uma resposta em
              andamento nem perde scroll e filtros. */}
          <main className="min-h-0 flex-1">
            <Pane active={view === "chat"}>
              <ChatView active={view === "chat"} meta={meta} />
            </Pane>
            <Pane active={view === "memory"}>
              <MemoryView active={view === "memory"} />
            </Pane>
            <Pane active={view === "logs"}>
              <LogsView active={view === "logs"} />
            </Pane>
            <Pane active={view === "metrics"}>
              <MetricsView active={view === "metrics"} />
            </Pane>
            <Pane active={view === "config"}>
              <ConfigView active={view === "config"} onSaved={() => void api.meta().then(setMeta)} />
            </Pane>
          </main>
        </div>
      </div>
      <StatusBar meta={meta} />
    </div>
  );
}

function Pane({ active, children }: { active: boolean; children: ReactNode }) {
  // Monta na primeira visita e nao desmonta mais.
  const [seen, setSeen] = useState(active);
  useEffect(() => {
    if (active) setSeen(true);
  }, [active]);
  return (
    <div className={active ? "h-full" : "hidden"}>
      {seen && <Suspense fallback={null}>{children}</Suspense>}
    </div>
  );
}
