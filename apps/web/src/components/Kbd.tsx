import type { ReactNode } from "react";
import { cn } from "cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-1 font-mono text-[0.62rem] text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
