import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import type { ChatStep } from "@elmatadore/api";
import { latency } from "@/lib/format";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Tools chamadas no turno, recolhidas por padrao. */
export function StepList({ steps, running = false }: { steps: ChatStep[]; running?: boolean }) {
  const tools = [...new Set(steps.map((s) => s.tool))];
  return (
    <Collapsible className="my-2 rounded-md border bg-muted/30 font-mono text-xs">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className="size-3 transition-transform [[data-state=open]_&]:rotate-90" />
        {running && <Loader2Icon className="size-3 animate-spin text-primary" />}
        <span>
          {running ? "executando" : "execução"} · {steps.length} {steps.length === 1 ? "passo" : "passos"}
        </span>
        <span className="ml-auto truncate text-[0.68rem]">{tools.join(" · ")}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col divide-y border-t">
        {steps.map((step, i) => (
          <div key={`${step.tool}-${i}`} className="px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="text-primary">{step.tool}</span>
              {step.duration_ms > 0 && <span className="text-muted-foreground">{latency(step.duration_ms)}</span>}
            </div>
            {step.args && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-muted-foreground">{step.args}</pre>}
            {step.output && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{step.output}</pre>}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
