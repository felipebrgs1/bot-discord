import { cn } from "cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Grupo de botoes exclusivo (filtro de nivel, tipo...). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap items-center gap-px rounded-md border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-sm px-2 font-mono text-[0.72rem] transition-colors",
            value === o.value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="tabular text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
