import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import bg from "@/assets/bg.jpg";
import { AuthScreen } from "@/components/AuthScreen";
import { Dashboard } from "@/components/Dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Caisse Vocale — Assistant Odoo Point de Vente" },
      { name: "description", content: "Ouvrez votre caisse, enregistrez vos ventes et clôturez à la voix, connecté à Odoo." },
      { property: "og:title", content: "Caisse Vocale — Assistant Odoo" },
      { property: "og:description", content: "Pilotez votre Point de Vente Odoo en langage naturel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <img src={bg} alt="" width={1920} height={1088} className="fixed inset-0 -z-10 h-full w-full object-cover" />
      {session === undefined ? null : session ? <Dashboard userId={session.user.id} /> : <AuthScreen />}
    </div>
  );
}
