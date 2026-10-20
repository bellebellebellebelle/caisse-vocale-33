import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Bot, User, ChevronRight, Archive, Check, Settings, LogOut, Send, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askAssistant, getRegisterState, saveOdooSettings } from "@/lib/assistant.functions";

type Msg = { id: string; role: string; content: string; data: any; created_at: string };
type Sale = { id: string; product_name: string; customer_name: string | null; amount: number; created_at: string };
type RegState = Awaited<ReturnType<typeof getRegisterState>>;

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const hm = (d: string) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export function Dashboard({ userId }: { userId: string }) {
  const ask = useServerFn(askAssistant);
  const fetchState = useServerFn(getRegisterState);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [reg, setReg] = useState<RegState | null>(null);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [text, setText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(new Date());
  const recRef = useRef<any>(null);

  const refreshState = useCallback(() => fetchState().then(setReg).catch(() => null), [fetchState]);

  useEffect(() => {
    supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(30)
      .then(({ data }) => setMsgs(((data as Msg[]) ?? []).reverse()));
    supabase.from("sales").select("*").order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setSales((data as Sale[]) ?? []));
    refreshState();
    const ch = supabase.channel(`rt-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${userId}` },
        (p) => setMsgs((m) => (m.some((x) => x.id === (p.new as Msg).id) ? m : [...m, p.new as Msg])))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sales", filter: `user_id=eq.${userId}` },
        (p) => setSales((s) => [p.new as Sale, ...s]))
      .on("postgres_changes", { event: "*", schema: "public", table: "odoo_settings", filter: `user_id=eq.${userId}` },
        () => refreshState())
      .subscribe();
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [userId, refreshState]);

  const send = async (t: string) => {
    if (!t.trim() || thinking) return;
    setThinking(true);
    try {
      const { reply } = await ask({ data: { text: t } });
      speak(reply);
      refreshState();
    } catch {
      speak("Désolé, une erreur est survenue.");
    } finally { setThinking(false); }
  };

  const speak = (t: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(t); u.lang = "fr-FR";
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  };

  const toggleMic = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("La reconnaissance vocale n'est pas disponible sur ce navigateur (utilisez Chrome ou Edge). Vous pouvez écrire votre demande."); return; }
    if (listening) { recRef.current?.stop(); return; }
    const r = new SR(); r.lang = "fr-FR"; r.interimResults = false;
    r.onresult = (e: any) => send(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r; window.speechSynthesis?.cancel(); r.start(); setListening(true);
  };

  const last = msgs.slice(-4);
  const slots = ["left-3 top-8", "right-3 top-24", "left-3 top-44", "right-3 top-60"];
  const lastChoices = [...msgs].reverse().find((m) => m.role === "assistant")?.data?.candidates as
    | { id: number; name: string; email: string | null }[] | undefined;
  const [picked, setPicked] = useState<number | null>(null);
  const session = reg && "session" in reg ? reg.session : null;

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 p-4 md:p-8">
      <div className="flex justify-end gap-2">
        <button onClick={() => setShowSettings(true)} className="glass rounded-full p-2" aria-label="Réglages Odoo"><Settings className="h-4 w-4" /></button>
        <button onClick={() => supabase.auth.signOut()} className="glass rounded-full p-2" aria-label="Déconnexion"><LogOut className="h-4 w-4" /></button>
      </div>

      {/* Voice panel */}
      <section className="glass-panel relative h-[360px] overflow-hidden rounded-3xl">
        <div className="absolute right-6 top-4 text-sm font-semibold text-foreground/90">{now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
        {last.map((m, i) => (
          <div key={m.id} className={`bubble absolute hidden w-[34%] rounded-xl px-4 py-2.5 md:block ${slots[i]}`}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">{m.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}{m.role === "user" ? "Vous" : "Assistant"}</span>
              <span>{hm(m.created_at)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm">{m.content}</p>
          </div>
        ))}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <button onClick={toggleMic} className="relative flex h-44 w-44 items-center justify-center rounded-full" aria-label="Commande vocale">
            <span className="mic-dots spin-slow absolute -inset-10 rounded-full" />
            {listening && <span className="listening-ring absolute inset-0 rounded-full border-2 border-primary" />}
            <span className="mic-orb absolute inset-0 rounded-full" />
            <Mic className={`relative h-16 w-16 text-primary ${thinking ? "animate-pulse" : ""}`} strokeWidth={1.8} />
          </button>
          <p className="mt-6 font-semibold">{listening ? "Je vous écoute…" : thinking ? "L'assistant réfléchit…" : "Commande vocale"}</p>
          <p className="text-xs text-muted-foreground">Cliquez pour parler à votre assistant</p>
          <form onSubmit={(e) => { e.preventDefault(); send(text); setText(""); }} className="mt-3 flex w-72 items-center gap-1 rounded-full bubble px-3 py-1">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="ou écrivez ici…" className="flex-1 bg-transparent text-sm outline-none" />
            <button aria-label="Envoyer"><Send className="h-4 w-4 text-primary" /></button>
          </form>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Caisse */}
        <section className="glass flex flex-col rounded-2xl p-5">
          <div className="flex items-center gap-3 border-b pb-4">
            <Archive className="h-7 w-7" />
            <div><h2 className="font-bold">Caisse</h2><p className="text-xs text-muted-foreground">Gestion de la caisse actuelle</p></div>
          </div>
          {!reg ? <p className="mt-6 text-sm text-muted-foreground">Chargement…</p> : !reg.connected ? (
            <div className="mt-6 space-y-3"><p className="text-sm text-muted-foreground">Connectez votre base Odoo pour commencer.</p>
              <button onClick={() => setShowSettings(true)} className="btn-violet flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-sm font-semibold text-primary">Connecter Odoo <ChevronRight className="h-4 w-4" /></button></div>
          ) : (
            <>
              <h3 className="mt-6 text-2xl font-bold text-primary">{session?.config ?? "Aucune caisse ouverte"}</h3>
              <p className="mt-1 flex items-center gap-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${session ? "bg-success" : "bg-muted-foreground"}`} /><span className={session ? "text-success" : "text-muted-foreground"}>{session ? "Ouverte" : "Fermée"}</span></p>
              {"error" in reg && reg.error && <p className="mt-2 text-xs text-destructive">{reg.error}</p>}
              <p className="mt-6 text-sm">Solde actuel</p>
              <p className="text-3xl font-bold">{eur(session?.balance ?? 0)}</p>
              <div className="mt-auto pt-6">
                <button onClick={() => send(session ? "Je veux fermer ma caisse, fais les comptes avant la validation." : "Quelles caisses puis-je ouvrir ?")}
                  className="btn-violet flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-sm font-semibold text-primary">
                  {session ? "Fermer la caisse" : "Ouvrir une caisse existante"} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </section>

        {/* Ventes */}
        <section className="glass flex flex-col rounded-2xl p-5">
          <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Ventes récentes</h2><ChevronRight className="h-5 w-5" /></div>
          <div className="mt-3 flex-1 divide-y">
            {sales.length === 0 && <p className="py-6 text-sm text-muted-foreground">Aucune vente pour l'instant. Dites par exemple « J'ai vendu un sac à dos à Julie Martin ».</p>}
            {(showAll ? sales : sales.slice(0, 3)).map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-secondary"><ShoppingBag className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><p className="truncate">{s.product_name}</p><p className="text-sm text-muted-foreground">{s.customer_name ?? hm(s.created_at)}</p></div>
                <p className="font-semibold">{eur(Number(s.amount))}</p>
              </div>
            ))}
          </div>
          <button onClick={() => setShowAll(!showAll)} className="mt-2 rounded-xl bg-secondary py-2.5 text-muted-foreground hover:text-foreground">{showAll ? "Réduire" : "Voir toutes les ventes"}</button>
        </section>

        {/* Clients */}
        <section className="glass flex flex-col rounded-2xl p-5">
          <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">{lastChoices?.length ? "Plusieurs clients détectés" : "Clients"}</h2><ChevronRight className="h-5 w-5" /></div>
          <p className="text-muted-foreground">{lastChoices?.length ? "Lequel voulez-vous sélectionner ?" : "Citez un client lors d'une vente"}</p>
          <div className="mt-3 flex-1 space-y-2">
            {(lastChoices ?? []).map((c) => (
              <button key={c.id} onClick={() => { setPicked(c.id); send(`Je sélectionne le client #${c.id} ${c.name}`); }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${picked === c.id ? "selected-row" : "border border-transparent hover:bg-secondary"}`}>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent font-semibold">{initials(c.name)}</div>
                <div className="min-w-0 flex-1"><p className="truncate">{c.name}</p><p className="truncate text-sm text-muted-foreground">{c.email ?? ""}</p></div>
                {picked === c.id && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-select"><Check className="h-4 w-4" /></span>}
              </button>
            ))}
          </div>
          <button onClick={() => send("Je veux créer un nouveau client")} className="mt-2 rounded-xl bg-secondary py-2.5 font-medium hover:bg-accent">Créer un nouveau client</button>
        </section>
      </div>

      {showSettings && <OdooSettings onClose={() => { setShowSettings(false); refreshState(); }} />}
    </div>
  );
}

function OdooSettings({ onClose }: { onClose: () => void }) {
  const save = useServerFn(saveOdooSettings);
  const [f, setF] = useState({ url: "", db: "", login: "", api_key: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from("odoo_settings").select("url, db, login").maybeSingle().then(({ data }) => data && setF((x) => ({ ...x, ...data })));
  }, []);
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <label className="block text-sm">{label}
      <input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required
        className="mt-1 w-full rounded-lg border bg-secondary px-3 py-2 outline-none focus:border-primary" />
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { await save({ data: f }); onClose(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }} className="glass w-full max-w-md space-y-3 rounded-2xl p-6">
        <h2 className="text-lg font-bold">Connexion à Odoo</h2>
        {field("url", "URL Odoo (ex: https://maboutique.odoo.com)")}
        {field("db", "Base de données")}
        {field("login", "Identifiant (email)")}
        {field("api_key", "Clé API (Préférences > Sécurité du compte)", "password")}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-secondary py-2">Annuler</button>
          <button disabled={busy} className="btn-violet flex-1 rounded-lg py-2 font-semibold text-primary">{busy ? "Vérification…" : "Enregistrer"}</button>
        </div>
      </form>
    </div>
  );
}
