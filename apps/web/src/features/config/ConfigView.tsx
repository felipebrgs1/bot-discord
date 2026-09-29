import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2Icon, RotateCcwIcon, SaveIcon } from "lucide-react";
import type { DiscordConfig } from "@elmatadore/api";
import { formatIds, parseIds } from "@/lib/ids";
import { useApi } from "@/app/api-context";
import { ViewHeader } from "@/components/shell/ViewHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface Form {
  discord: DiscordConfig;
  model: string;
}

/** IDs editados como texto; so viram lista ao salvar (nao come a virgula no meio da digitacao). */
interface Draft {
  guild_id: string;
  channels: string;
  admins: string;
  web_user_id: string;
  personality: string;
  model: string;
}

const toDraft = ({ discord, model }: Form): Draft => ({
  guild_id: discord.guild_id,
  channels: formatIds(discord.channel_ids),
  admins: formatIds(discord.admin_ids),
  web_user_id: discord.web_user_id,
  personality: discord.personality,
  model,
});

const sameDraft = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);

export default function ConfigView({ active, onSaved }: { active: boolean; onSaved: () => void }) {
  const api = useApi();
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [discord, catalog] = await Promise.all([api.discordConfig(), api.models()]);
      const next = toDraft({ discord, model: catalog.model });
      setSaved(next);
      setDraft(next);
      setModels(catalog.models);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar");
    }
  }, [api]);

  useEffect(() => {
    if (active && !saved) void load();
  }, [active, saved, load]);

  const dirty = saved !== null && draft !== null && !sameDraft(saved, draft);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  async function save() {
    if (!draft || !saved) return;
    setBusy(true);
    try {
      const discordChanged = (["guild_id", "channels", "admins", "web_user_id", "personality"] as const).some((k) => draft[k] !== saved[k]);
      let restart = false;
      if (discordChanged) {
        const res = await api.saveDiscordConfig({
          guild_id: draft.guild_id.trim(),
          channel_ids: parseIds(draft.channels),
          admin_ids: parseIds(draft.admins),
          web_user_id: draft.web_user_id.trim(),
          personality: draft.personality,
        });
        restart = res.restart_required;
      }
      if (draft.model !== saved.model) restart = (await api.setModel(draft.model.trim())).restart_required || restart;
      toast.success(restart ? "salvo · servidor e canais valem após reiniciar o bot" : "salvo");
      await load();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Config" meta={dirty ? <span className="text-warning">alterações não salvas</span> : "discord, personalidade e modelo"}>
        <Button size="sm" variant="ghost" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
          <RotateCcwIcon /> descartar
        </Button>
        <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} salvar
        </Button>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!draft ? (
          <div className="grid max-w-3xl gap-3 p-4">
            {error && <p className="font-mono text-xs text-destructive">! {error}</p>}
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <form
            className="max-w-3xl divide-y"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Section title="discord" hint="Servidor, canais e papéis. Valem após reiniciar o bot.">
              <Field id="guild" label="servidor" hint="guild_id">
                <Input id="guild" value={draft.guild_id} onChange={(e) => set({ guild_id: e.target.value })} className="font-mono" />
              </Field>
              <Field id="channels" label="canais" hint="um id por linha">
                <Textarea id="channels" rows={3} value={draft.channels} onChange={(e) => set({ channels: e.target.value })} className="font-mono" />
              </Field>
              <Field id="admins" label="admins" hint="um id por linha">
                <Textarea id="admins" rows={2} value={draft.admins} onChange={(e) => set({ admins: e.target.value })} className="font-mono" />
              </Field>
              <Field id="web-user" label="usuário do painel" hint="papel do chat web; vazio = user">
                <Input id="web-user" value={draft.web_user_id} onChange={(e) => set({ web_user_id: e.target.value })} className="font-mono" />
              </Field>
            </Section>

            <Section title="agente" hint="Modelo vale na próxima sessão; personalidade derruba as sessões abertas.">
              <Field id="model" label="modelo" hint="vazio = padrão do pi">
                <Input id="model" list="model-catalog" value={draft.model} onChange={(e) => set({ model: e.target.value })} placeholder="(padrão do pi)" className="font-mono" />
                <datalist id="model-catalog">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field id="personality" label="personalidade" hint="complemento ao personality.md">
                <Textarea id="personality" rows={10} value={draft.personality} onChange={(e) => set({ personality: e.target.value })} className="font-mono text-xs leading-relaxed" />
              </Field>
            </Section>
          </form>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 px-4 py-5 md:grid-cols-[12rem_minmax(0,1fr)]">
      <div>
        <h2 className="label-mono text-foreground">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2">
        <span className="text-[0.92rem] font-medium">{label}</span>
        {hint && <span className="font-mono text-[0.68rem] text-muted-foreground">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
