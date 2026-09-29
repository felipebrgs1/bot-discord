import type { ChatMessage, ChatStep } from "@elmatadore/api";
import { time } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { StepList } from "@/features/chat/StepList";

/** Linha de transcricao: autor em mono na margem, conteudo ao lado. */
export function MessageRow({ message, steps, quoted }: { message: ChatMessage; steps?: ChatStep[]; quoted?: ChatMessage }) {
  const bot = message.is_bot;
  return (
    <article className="group grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <div className="flex flex-col items-end pt-0.5 text-right">
        <span className={bot ? "font-mono text-xs font-semibold text-primary" : "truncate font-mono text-xs text-foreground"}>
          {bot ? "bot" : message.author_name || "você"}
        </span>
        <span className="tabular font-mono text-[0.65rem] text-muted-foreground">{time(message.created_at)}</span>
      </div>
      <div className={bot ? "min-w-0 border-l border-primary/40 pl-3" : "min-w-0 border-l pl-3"}>
        {quoted && (
          <p className="mb-1 line-clamp-1 font-mono text-[0.7rem] text-muted-foreground">
            ↳ {quoted.author_name}: {quoted.content}
          </p>
        )}
        {bot ? <Markdown content={message.content} /> : <p className="text-[1rem] leading-relaxed whitespace-pre-wrap">{message.content}</p>}
        {steps && steps.length > 0 && <StepList steps={steps} />}
        {bot && (
          <div className="mt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <CopyButton text={message.content} label="copiar" />
          </div>
        )}
      </div>
    </article>
  );
}
