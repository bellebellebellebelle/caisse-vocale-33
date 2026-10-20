import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function AuthScreen() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = mode === "up"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-4 rounded-2xl p-8">
        <h1 className="text-2xl font-bold">Caisse Vocale</h1>
        <p className="text-sm text-muted-foreground">{mode === "in" ? "Connectez-vous à votre assistant" : "Créez votre compte"}</p>
        <input className="w-full rounded-lg border bg-secondary px-3 py-2 outline-none focus:border-primary" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full rounded-lg border bg-secondary px-3 py-2 outline-none focus:border-primary" type="password" placeholder="Mot de passe (6+ caractères)" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button disabled={busy} className="btn-violet w-full rounded-lg py-2.5 font-semibold text-primary">{mode === "in" ? "Se connecter" : "Créer mon compte"}</button>
        <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="w-full text-sm text-muted-foreground hover:text-foreground">
          {mode === "in" ? "Pas de compte ? Créer un compte" : "Déjà un compte ? Se connecter"}
        </button>
      </form>
    </div>
  );
}
