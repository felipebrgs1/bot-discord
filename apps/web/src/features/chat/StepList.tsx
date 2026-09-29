import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import type { ChatStep } from "@elmatadore/api";
import { latency } from "@/lib/format";
import { groupSteps } from "@/lib/steps";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Tools chamadas no turno, recolhidas por padrao. */
export function StepList({ steps, running = false }: { steps: ChatStep[]; running?: boolean }) {
  const tools = [...new Set(steps.map((s) => s.tool))];
  const groups = groupSteps(steps);
  const agents = groups.filter((g) => g.agent !== undefined).length;
  return (
    <Collapsible className="my-2 rounded-md border bg-muted/30 font-mono text-xs">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className="size-3 transition-transform [[data-state=open]_&]:rotate-90" />
        {running && <Loader2Icon className="size-3 animate-spin text-primary" />}
        <span>
          {running ? "executando" : "execução"} · {steps.length} {steps.length === 1 ? "passo" : "passos"}
          {agents > 0 && ` · ${agents} ${agents === 1 ? "agente" : "agentes"}`}
        </span>
        <span className="ml-auto truncate text-[0.68rem]">{tools.join(" · ")}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col divide-y border-t">
        {groups.map((group) => (
          <div key={group.label || "main"} className="flex flex-col divide-y">
            {group.label && (
              <div className="bg-muted/50 px-2.5 py-1 text-[0.68rem] uppercase tracking-wide text-muted-foreground">{group.label}</div>
            )}
            {group.steps.map((step, i) => (
              <div key={`${step.tool}-${i}`} className="px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-primary">{step.tool}</span>
                  {step.duration_ms > 0 && <span className="text-muted-foreground">{latency(step.duration_ms)}</span>}
                </div>
                {step.args && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-muted-foreground">{step.args}</pre>}
                {step.output && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{step.output}</pre>}
              </div>
            ))}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
