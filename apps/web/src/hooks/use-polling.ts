import { useEffect, useRef } from "react";

/**
 * Roda `tick` agora e a cada `ms` enquanto `enabled`. O ultimo `tick` vive em
 * ref: trocar a funcao nao recria o timer. Um tick so comeca quando o anterior
 * termina (sem corrida de respostas fora de ordem).
 */
export function usePolling(tick: () => Promise<void>, ms: number, enabled: boolean): void {
  const ref = useRef(tick);
  ref.current = tick;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: number | undefined;
    const loop = async () => {
      await ref.current().catch(() => undefined);
      if (!stopped) timer = window.setTimeout(() => void loop(), ms);
    };
    void loop();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [ms, enabled]);
}
