import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUpIcon, ListIcon, SquareIcon } from "lucide-react";
import type { ChatMessage, ChatSession, ChatStep, Meta } from "@elmatadore/api";
import { newSessionId } from "@/lib/ids";
import { useApi } from "@/app/api-context";
import { ViewHeader } from "@/components/shell/ViewHeader";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { MessageRow } from "@/features/chat/MessageRow";
import { SessionList } from "@/features/chat/SessionList";
import { StepList } from "@/features/chat/StepList";

const SUGGESTIONS = [
  "O que você aprendeu com o grupo recentemente?",
  "Resuma as últimas conversas do canal.",
  "Quais ferramentas você tem agora?",
];

const LOCAL = "local-";

export function ChatView({ active, meta }: { active: boolean; meta: Meta | null }) {
  const api = useApi();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stepsByMessage, setStepsByMessage] = useState<Record<string, ChatStep[]>>({});
  const [pending, setPending] = useState<ChatStep[] | null>(null);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Geracao vigente: resposta em voo ou fetch antigo nao sobrescreve a sessao nova.
  const genRef = useRef(0);
  // Sessao criada pelo proprio envio: abrir ela nao recarrega nem aborta o stream.
  const createdRef = useRef<string | null>(null);

  const loadSessions = useCallback(() => {
    api
      .sessions()
      .then((d) => setSessions(d.sessions))
      .catch(() => setSessions([]));
  }, [api]);

  useEffect(() => {
    if (active) loadSessions();
  }, [active, loadSessions]);

  useEffect(() => {
    if (current && current === createdRef.current) {
      createdRef.current = null;
      return;
    }
    const gen = ++genRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(null);
    setError("");
    setStepsByMessage({});
    if (!current) {
      setMessages([]);
      return;
    }
    api
      .history(current)
      .then((d) => genRef.current === gen && setMessages(d.messages))
      .catch((err: unknown) => genRef.current === gen && setError(err instanceof Error ? err.message : "não foi possível carregar"));
  }, [api, current]);

  // So o desmonte real cancela a resposta (trocar de aba mantem a tela montada).
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (active) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending, active]);

  const open = useCallback((id: string | null) => {
    setCurrent(id);
    setListOpen(false);
  }, []);

  const remove = useCallback(
    (id: string) => {
      api
        .deleteSession(id)
        .then(() => {
          toast.success("sessão excluída");
          if (current === id) setCurrent(null);
          loadSessions();
        })
        .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "não foi possível excluir"));
    },
    [api, current, loadSessions],
  );

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || pending !== null) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const gen = genRef.current;
    const id = current ?? newSessionId((b) => crypto.getRandomValues(b));
    const local: ChatMessage = {
      id: `${LOCAL}${genRef.current}-${messages.length}`,
      author_id: "web",
      author_name: "você",
      content,
      is_bot: false,
      created_at: new Date().toISOString(),
    };
    setMessages((ms) => [...ms, local]);
    setInput("");
    setError("");
    setPending([]);
    if (!current) {
      createdRef.current = id;
      setCurrent(id);
    }

    let echoed = false;
    const live = () => genRef.current === gen;
    const withoutLocal = (ms: ChatMessage[]) => ms.filter((m) => !m.id.startsWith(LOCAL));
    await api.sendChat(id, content, {
      signal: controller.signal,
      accepted: (message) => {
        if (!live()) return;
        echoed = true;
        setMessages((ms) => [...withoutLocal(ms), message]);
      },
      step: (step) => live() && setPending((steps) => [...(steps ?? []), step]),
      done: (message, steps) => {
        if (!live()) return;
        setPending(null);
        setMessages((ms) => [...withoutLocal(ms), message]);
        setStepsByMessage((map) => ({ ...map, [message.id]: steps }));
        loadSessions();
      },
      error: (text) => {
        if (!live()) return;
        setPending(null);
        setError(text);
        // O texto digitado nao some quando o envio falha antes do eco.
        if (!echoed) setMessages((ms) => (ms.some((m) => m.id === local.id) ? ms : [...ms, local]));
        loadSessions();
      },
    });
    abortRef.current = null;
  }, [api, current, input, loadSessions, messages.length, pending]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(null);
  }, []);

  const canChat = meta?.chat === true;
  const title = sessions.find((s) => s.id === current)?.title;
  const list = <SessionList sessions={sessions} current={current} onOpen={open} onNew={() => open(null)} onDelete={remove} />;

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r lg:block">{list}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <ViewHeader title="Conversa" meta={current ? `${title || "sem título"} · ${current}` : "sessão nova"}>
          <Sheet open={listOpen} onOpenChange={setListOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="lg:hidden">
                <ListIcon /> sessões
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 p-0">
              <SheetTitle className="sr-only">Sessões</SheetTitle>
              {list}
            </SheetContent>
          </Sheet>
        </ViewHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
            {messages.length === 0 && pending === null && <Intro disabled={!canChat} onPick={setInput} />}
            {messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                steps={stepsByMessage[m.id]}
                quoted={m.reply_to ? messages.find((q) => q.id === m.reply_to) : undefined}
              />
            ))}
            {pending !== null && (
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[6rem_minmax(0,1fr)]">
                <span className="pt-2 text-right font-mono text-xs font-semibold text-primary">bot</span>
                <div className="border-l border-primary/40 pl-3">
                  {pending.length > 0 ? (
                    <StepList steps={pending} running />
                  ) : (
                    <p className="py-1.5 font-mono text-xs text-muted-foreground">
                      pensando<span className="animate-pulse">_</span>
                    </p>
                  )}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t bg-card/40 px-4 py-3">
          <div className="mx-auto max-w-3xl">
            {error && (
              <p role="alert" className="mb-2 font-mono text-xs text-destructive">
                ! {error}
              </p>
            )}
            <div className="flex items-end gap-2 rounded-md border bg-background px-2 py-1.5 focus-within:border-ring">
              <span aria-hidden className="pb-1.5 pl-1 font-mono text-primary">
                &gt;
              </span>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={canChat ? "mensagem para o bot" : "chat indisponível"}
                aria-label="Mensagem"
                disabled={!canChat}
                rows={1}
                className="max-h-48 min-h-8 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              {pending !== null ? (
                <Button size="icon-sm" variant="outline" onClick={stop} aria-label="Parar">
                  <SquareIcon />
                </Button>
              ) : (
                <Button size="icon-sm" onClick={() => void send()} disabled={!canChat || input.trim().length === 0} aria-label="Enviar">
                  <ArrowUpIcon />
                </Button>
              )}
            </div>
            <p className="mt-1.5 font-mono text-[0.65rem] text-muted-foreground">enter envia · shift+enter quebra linha</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Intro({ disabled, onPick }: { disabled: boolean; onPick: (text: string) => void }) {
  return (
    <div className="py-10">
      <p className="font-mono text-sm">
        <span className="text-primary">elmatadore</span> <span className="text-muted-foreground">~ conversa direta com o bot, com memória e ferramentas.</span>
      </p>
      <ul className="mt-4 flex flex-col gap-1">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              className="w-full rounded-sm px-2 py-1.5 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <span className="text-primary">→</span> {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
