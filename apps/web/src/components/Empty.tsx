import type { ReactNode } from "react";

/** Estado vazio de console: uma linha mono e, opcional, uma dica. */
export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">
        <span className="text-primary">$</span> {title}
      </p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground/80">{hint}</p>}
      {children}
    </div>
  );
}
