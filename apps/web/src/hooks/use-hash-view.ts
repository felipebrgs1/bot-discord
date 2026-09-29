import { useCallback, useEffect, useState } from "react";
import { hashFor, viewFromHash, type View } from "@/lib/nav";

/** View atual espelhada no hash (#/logs), com voltar/avancar do navegador. */
export function useHashView(): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setView(viewFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((next: View) => {
    setView(next);
    if (window.location.hash !== hashFor(next)) window.location.hash = hashFor(next);
  }, []);

  return [view, navigate];
}
