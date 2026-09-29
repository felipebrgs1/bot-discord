import { useState, type FormEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { useApi } from "@/app/api-context";
import { Wordmark } from "@/components/shell/Rail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-dvh place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-xs">
        <div className="mb-8 flex flex-col items-start gap-3">
          <Wordmark />
          <p className="font-mono text-xs text-muted-foreground">
            <span className="text-primary">&gt;</span> painel de controle. senha para continuar.
          </p>
        </div>
        <label htmlFor="password" className="label-mono">
          senha
        </label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            className="font-mono"
          />
          <Button type="submit" disabled={busy || password.length === 0}>
            {busy ? <Loader2Icon className="animate-spin" /> : "entrar"}
          </Button>
        </div>
        <p role="alert" className="mt-2 min-h-5 font-mono text-xs text-destructive">
          {error}
        </p>
      </form>
    </div>
  );
}
