import { createContext, useContext, type ReactNode } from "react";
import type { PanelApi } from "@/lib/api/client";

const ApiContext = createContext<PanelApi | null>(null);

export function ApiProvider({ api, children }: { api: PanelApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): PanelApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi fora do ApiProvider");
  return api;
}
