import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool, isStepCount, type ModelMessage } from "ai";
import { z } from "zod";
import { odooClient, sessionSummary, isAllowedModel, type Odoo } from "./odoo.server";

type Ctx = { supabase: any; userId: string };

const INSTRUCTIONS = `Tu es l'assistant de caisse vocal d'un commerçant, connecté à son Odoo (module Point de Vente, Contacts, Produits).
Réponds toujours en français, en une ou deux phrases courtes (tes réponses sont lues à voix haute). Pas de markdown.
Règles :
- Ouvrir une caisse : utilise list_pos_configs pour trouver la caisse demandée (correspondance approximative du nom), puis open_pos_session.
- Vente : cherche le produit avec search_products. Si un prénom/nom de client est cité, cherche avec search_customers.
  * 1 seul résultat évident -> utilise-le.
  * plusieurs candidats plausibles -> appelle propose_customer_choice et demande à l'utilisateur lequel choisir, sans enregistrer la vente. Quand l'utilisateur choisit (message "Je sélectionne le client #ID"), enregistre la vente en attente avec ce client.
  * aucun résultat -> demande s'il faut créer le client ou enregistrer sans client.
  Sans client cité, enregistre la vente sans client. Si plusieurs produits correspondent, demande lequel.
- Créer un client : create_customer avec toutes les infos données.
- Fermeture : appelle d'abord prepare_closing et annonce les comptes (total ventes, par mode de paiement, espèces attendues), puis demande confirmation. Ne ferme (close_pos_session) qu'après confirmation explicite.
- Pour toute autre fonctionnalité native du Point de Vente (remboursements, historique, stocks, prix, moyens de paiement...), utilise odoo_call (search_read, read, write, create, méthodes métier). Demande confirmation avant toute suppression.
Montants en euros.`;

export async function runAssistant(ctx: Ctx, text: string) {
  const { data: settings } = await ctx.supabase.from("odoo_settings").select("*").eq("user_id", ctx.userId).maybeSingle();
  await ctx.supabase.from("messages").insert({ user_id: ctx.userId, role: "user", content: text });

  const save = async (content: string, data: unknown = null) => {
    await ctx.supabase.from("messages").insert({ user_id: ctx.userId, role: "assistant", content, data });
    return { reply: content };
  };
  if (!settings) return save("Connectez d'abord votre base Odoo dans les réglages.");

  let odoo: Odoo;
  try {
    odoo = await odooClient(settings);
  } catch (e) {
    return save(`Connexion à Odoo impossible : ${(e as Error).message}`);
  }

  const { data: hist } = await ctx.supabase
    .from("messages").select("role, content").eq("user_id", ctx.userId)
    .order("created_at", { ascending: false }).limit(20);
  const messages: ModelMessage[] = (hist ?? []).reverse().map((m: any) => ({ role: m.role, content: m.content }));

  let sessionId: number | null = settings.session_id;
  let choices: unknown = null;
  const setSession = async (id: number | null, configId?: number) => {
    sessionId = id;
    await ctx.supabase.from("odoo_settings").update({ session_id: id, ...(configId ? { config_id: configId } : {}) }).eq("user_id", ctx.userId);
  };
  const safe = <A,>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
    try { return await fn(a); } catch (e) { return { error: (e as Error).message }; }
  };

  const tools = {
    list_pos_configs: tool({
      description: "Liste les caisses (pos.config) et l'état de leur session.",
      inputSchema: z.object({}),
      execute: safe(async () => odoo.call("pos.config", "search_read", [[]], { fields: ["id", "name", "current_session_id", "current_session_state"] })),
    }),
    open_pos_session: tool({
      description: "Ouvre (ou reprend) la session d'une caisse.",
      inputSchema: z.object({ config_id: z.number(), opening_cash: z.number().nullable() }),
      execute: safe(async ({ config_id, opening_cash }) => {
        const existing = await odoo.call<any[]>("pos.session", "search_read",
          [[["config_id", "=", config_id], ["state", "!=", "closed"]]], { fields: ["id", "state"], limit: 1 });
        let id = existing[0]?.id as number | undefined;
        if (!id) id = await odoo.call<number>("pos.session", "create", [{ config_id }]);
        const [s] = await odoo.call<any[]>("pos.session", "read", [[id]], { fields: ["state"] });
        if (s.state === "opening_control") {
          try { await odoo.call("pos.session", "set_cashbox_pos", [[id], opening_cash ?? 0, ""]); }
          catch { await odoo.call("pos.session", "action_pos_session_open", [[id]]).catch(() => null); }
        }
        await setSession(id, config_id);
        return sessionSummary(odoo, id);
      }),
    }),
    get_session_status: tool({
      description: "État et solde de la session de caisse actuelle.",
      inputSchema: z.object({}),
      execute: safe(async () => (sessionId ? sessionSummary(odoo, sessionId) : { error: "Aucune caisse ouverte" })),
    }),
    search_products: tool({
      description: "Cherche des produits vendables en caisse par nom ou code.",
      inputSchema: z.object({ query: z.string() }),
      execute: safe(async ({ query }) => odoo.call("product.product", "search_read",
        [["&", ["available_in_pos", "=", true], "|", ["name", "ilike", query], ["default_code", "ilike", query]]],
        { fields: ["id", "display_name", "lst_price"], limit: 8 })),
    }),
    search_customers: tool({
      description: "Cherche des clients (res.partner) par nom, email ou téléphone.",
      inputSchema: z.object({ query: z.string() }),
      execute: safe(async ({ query }) => {
        const words = query.trim().split(/\s+/);
        const domain: unknown[] = [];
        for (const w of words) domain.push(["name", "ilike", w]);
        let r = await odoo.call<any[]>("res.partner", "search_read", [domain], { fields: ["id", "name", "email", "phone"], limit: 8 });
        if (!r.length) r = await odoo.call<any[]>("res.partner", "search_read",
          [["|", "|", ["name", "ilike", words[words.length - 1]], ["email", "ilike", query], ["phone", "ilike", query]]],
          { fields: ["id", "name", "email", "phone"], limit: 8 });
        return r;
      }),
    }),
    propose_customer_choice: tool({
      description: "Affiche à l'utilisateur une liste de clients possibles pour qu'il choisisse.",
      inputSchema: z.object({ candidates: z.array(z.object({ id: z.number(), name: z.string(), email: z.string().nullable() })) }),
      execute: async ({ candidates }) => { choices = { type: "choices", candidates }; return { shown: true }; },
    }),
    create_customer: tool({
      description: "Crée un client dans Odoo Contacts.",
      inputSchema: z.object({
        name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), street: z.string().nullable(),
        city: z.string().nullable(), zip: z.string().nullable(), comment: z.string().nullable(),
      }),
      execute: safe(async (v) => {
        const vals = Object.fromEntries(Object.entries(v).filter(([, x]) => x));
        const id = await odoo.call<number>("res.partner", "create", [vals]);
        return { id, name: v.name };
      }),
    }),
    record_sale: tool({
      description: "Enregistre une vente payée dans la session ouverte.",
      inputSchema: z.object({
        lines: z.array(z.object({ product_id: z.number(), qty: z.number(), price_unit: z.number().nullable() })),
        partner_id: z.number().nullable(),
        payment_method: z.string().nullable().describe("Nom du moyen de paiement (ex: Espèces, Carte). Null = premier disponible."),
      }),
      execute: safe(async ({ lines, partner_id, payment_method }) => {
        if (!sessionId) return { error: "Aucune caisse ouverte" };
        const [sess] = await odoo.call<any[]>("pos.session", "read", [[sessionId]], { fields: ["config_id", "payment_method_ids"] });
        const products = await odoo.call<any[]>("product.product", "read", [lines.map((l) => l.product_id)], { fields: ["display_name", "lst_price", "taxes_id"] });
        let total = 0;
        const orderLines = lines.map((l) => {
          const p = products.find((x) => x.id === l.product_id);
          const price = l.price_unit ?? p?.lst_price ?? 0;
          const sub = price * l.qty;
          total += sub;
          return [0, 0, { product_id: l.product_id, qty: l.qty, price_unit: price, price_subtotal: sub, price_subtotal_incl: sub, full_product_name: p?.display_name, tax_ids: [[6, 0, []]] }];
        });
        const methods = await odoo.call<any[]>("pos.payment.method", "read", [sess.payment_method_ids], { fields: ["name"] });
        const method = (payment_method && methods.find((m) => m.name.toLowerCase().includes(payment_method.toLowerCase()))) || methods[0];
        const orderId = await odoo.call<number>("pos.order", "create", [{
          session_id: sessionId, partner_id: partner_id || false, lines: orderLines,
          amount_total: total, amount_tax: 0, amount_paid: total, amount_return: 0,
        }]);
        await odoo.call("pos.payment", "create", [{ pos_order_id: orderId, amount: total, payment_method_id: method.id }]);
        await odoo.call("pos.order", "action_pos_order_paid", [[orderId]]).catch(() => null);
        let customer: string | null = null;
        if (partner_id) customer = (await odoo.call<any[]>("res.partner", "read", [[partner_id]], { fields: ["name"] }))[0]?.name ?? null;
        await ctx.supabase.from("sales").insert({
          user_id: ctx.userId, odoo_order_id: orderId, amount: total, customer_name: customer,
          product_name: products.map((p) => p.display_name).join(", "),
        });
        return { order_id: orderId, total, customer, payment_method: method.name };
      }),
    }),
    prepare_closing: tool({
      description: "Fait les comptes de la session avant fermeture.",
      inputSchema: z.object({}),
      execute: safe(async () => (sessionId ? sessionSummary(odoo, sessionId) : { error: "Aucune caisse ouverte" })),
    }),
    close_pos_session: tool({
      description: "Valide la fermeture de la session (après confirmation de l'utilisateur).",
      inputSchema: z.object({ counted_cash: z.number().nullable() }),
      execute: safe(async ({ counted_cash }) => {
        if (!sessionId) return { error: "Aucune caisse ouverte" };
        const sum = await sessionSummary(odoo, sessionId);
        const cash = counted_cash ?? sum?.balance ?? 0;
        await odoo.call("pos.session", "post_closing_cash_details", [[sessionId], cash]).catch(() => null);
        try {
          await odoo.call("pos.session", "close_session_from_ui", [[sessionId]]);
        } catch {
          await odoo.call("pos.session", "action_pos_session_closing_control", [[sessionId]]);
        }
        await setSession(null);
        return { closed: true, summary: sum };
      }),
    }),
    odoo_call: tool({
      description: "Appel générique Odoo pour toute fonctionnalité native (modèles pos.*, res.partner, product.*, account.*, stock.*).",
      inputSchema: z.object({ model: z.string(), method: z.string(), args_json: z.string().describe("Tableau JSON des arguments positionnels"), kwargs_json: z.string().nullable() }),
      execute: safe(async ({ model, method, args_json, kwargs_json }) => {
        if (!isAllowedModel(model)) return { error: "Modèle non autorisé" };
        const r = await odoo.call(model, method, JSON.parse(args_json || "[]"), kwargs_json ? JSON.parse(kwargs_json) : {});
        return JSON.stringify(r).slice(0, 6000);
      }),
    }),
  };

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return save("Le service IA n'est pas configuré.");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  try {
    const result = streamText({
      model: provider.responses("openai/gpt-6-astra"),
      instructions: INSTRUCTIONS + `\nSession actuelle : ${sessionId ?? "aucune"}. Date : ${new Date().toISOString()}`,
      messages,
      tools,
      stopWhen: isStepCount(50),
      providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", store: false, include: ["reasoning.encrypted_content"] } },
    });
    const reply = (await result.text).trim() || "C'est fait.";
    return save(reply, choices);
  } catch (e: any) {
    const status = e?.statusCode ?? e?.status;
    const msg = status === 402 ? "Crédits IA épuisés." : status === 429 ? "Trop de demandes, réessayez dans un instant." : "Désolé, une erreur est survenue.";
    console.error(e);
    return save(msg);
  }
}
