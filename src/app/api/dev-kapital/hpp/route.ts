import { NextResponse } from "next/server";
import { fakeKapitalEnabled, readFakeOrder } from "@/app/api/dev-kapital/_store";

export const dynamic = "force-dynamic";

/**
 * Fake Hosted Payment Page (dev/E2E only). Deliberately styled unlike
 * AVTOSH and free of any card fields — it only simulates the OUTCOME
 * of a hosted payment. Opening requires the order id + password pair,
 * mirroring the provider contract.
 */
export async function GET(request: Request): Promise<Response> {
  if (!fakeKapitalEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const password = params.get("password") ?? "";
  const order = await readFakeOrder(id);
  if (order === null || order.password !== password) {
    return new NextResponse("<h1>Invalid order</h1>", {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const form = (action: string, label: string) => `
    <form method="post" action="/api/dev-kapital/hpp/complete" style="display:inline">
      <input type="hidden" name="id" value="${order.id}" />
      <input type="hidden" name="password" value="${order.password}" />
      <input type="hidden" name="action" value="${action}" />
      <button type="submit" data-testid="fake-hpp-${action}"
        style="padding:14px 22px;margin:6px;font-size:16px;cursor:pointer">${label}</button>
    </form>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
    <title>FAKE Kapital HPP (test only)</title></head>
    <body style="font-family:monospace;background:#1a1a2e;color:#eee;text-align:center;padding:60px">
      <h1>FAKE Kapital Bank — Hosted Payment Page</h1>
      <p>Test double for local/E2E use. No real payment happens here.</p>
      <p data-testid="fake-hpp-amount">${order.amount} ${order.currency}</p>
      ${form("pay", "Pay (simulate success)")}
      ${form("decline", "Decline")}
      ${form("cancel", "Cancel")}
    </body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
