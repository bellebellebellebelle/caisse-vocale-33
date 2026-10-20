import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const credsSchema = z.object({
  url: z.string().url(),
  db: z.string().min(1),
  login: z.string().min(1),
  api_key: z.string().min(1),
});

export const saveOdooSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => credsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { odooClient } = await import("./odoo.server");
    await odooClient(data); // throws if invalid
    const { error } = await context.supabase
      .from("odoo_settings")
      .upsert({ user_id: context.userId, ...data, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function loadOdoo(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.from("odoo_settings").select("*").eq("user_id", context.userId).maybeSingle();
  if (!data) return null;
  const { odooClient } = await import("./odoo.server");
  return { settings: data, odoo: await odooClient(data) };
}

export const getRegisterState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("odoo_settings")
      .select("url, session_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) return { connected: false as const };
    try {
      const l = await loadOdoo(context);
      const { sessionSummary } = await import("./odoo.server");
      const configs = await l!.odoo.call<any[]>("pos.config", "search_read", [[]], {
        fields: ["id", "name", "current_session_state"],
      });
      const session = data.session_id ? await sessionSummary(l!.odoo, data.session_id) : null;
      return {
        connected: true as const,
        url: data.url,
        configs: configs.map((c) => ({ id: c.id as number, name: String(c.name), state: String(c.current_session_state || "") })),
        session: session && session.state !== "closed" ? JSON.parse(JSON.stringify(session)) as {
          name: string; config: string; state: string; balance: number; total_sales: number; orders: number;
        } : null,
      };
    } catch (e) {
      return { connected: true as const, url: data.url, error: (e as Error).message, configs: [], session: null };
    }
  });

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ text: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { runAssistant } = await import("./assistant.server");
    return runAssistant(context, data.text);
  });
