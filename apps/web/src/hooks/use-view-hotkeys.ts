import { useEffect } from "react";
import { VIEWS, type View } from "@/lib/nav";

/** Alt+1..5 troca de tela, inclusive digitando (Alt nao conflita com texto). */
export function useViewHotkeys(navigate: (view: View) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const index = Number(e.code.replace("Digit", "")) - 1;
      const view = VIEWS[index];
      if (!view) return;
      e.preventDefault();
      navigate(view);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
