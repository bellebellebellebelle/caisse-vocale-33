// Minimal Odoo JSON-RPC client (server-only). No external dependency.
export type OdooCreds = { url: string; db: string; login: string; api_key: string };

async function rpc(url: string, service: string, method: string, args: unknown[]) {
  const res = await fetch(`${url.replace(/\/+$/, "")}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }),
  });
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string; data?: { message?: string } } };
  if (json.error) throw new Error(json.error.data?.message || json.error.message);
  return json.result;
}

export async function odooClient(c: OdooCreds) {
  const uid = (await rpc(c.url, "common", "authenticate", [c.db, c.login, c.api_key, {}])) as number | false;
  if (!uid) throw new Error("Identifiants Odoo invalides");
  const call = <T = unknown>(model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) =>
    rpc(c.url, "object", "execute_kw", [c.db, uid, c.api_key, model, method, args, kwargs]) as Promise<T>;
  return { uid, call };
}
export type Odoo = Awaited<ReturnType<typeof odooClient>>;

const ALLOWED = [/^pos\./, /^res\.partner/, /^product\./, /^account\.(journal|tax|move)/, /^stock\./, /^loyalty\./, /^res\.currency/, /^uom\./];
export const isAllowedModel = (m: string) => ALLOWED.some((r) => r.test(m));

export async function sessionSummary(o: Odoo, sessionId: number) {
  const [s] = await o.call<any[]>("pos.session", "read", [[sessionId]], {
    fields: ["name", "state", "config_id", "cash_register_balance_start", "start_at"],
  });
  if (!s) return null;
  const payments = await o.call<any[]>("pos.payment", "search_read", [[["session_id", "=", sessionId]]], {
    fields: ["amount", "payment_method_id"],
  });
  const byMethod: Record<string, number> = {};
  let total = 0;
  for (const p of payments) {
    const k = p.payment_method_id?.[1] ?? "Autre";
    byMethod[k] = (byMethod[k] ?? 0) + p.amount;
    total += p.amount;
  }
  const orders = await o.call<number>("pos.order", "search_count", [[["session_id", "=", sessionId]]]);
  return {
    id: sessionId,
    name: s.name,
    state: s.state,
    config: s.config_id?.[1],
    opening_cash: s.cash_register_balance_start ?? 0,
    total_sales: total,
    balance: (s.cash_register_balance_start ?? 0) + total,
    orders,
    by_payment_method: byMethod,
  };
}
