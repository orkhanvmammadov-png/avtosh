import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import {
  fakeKapitalEnabled,
  readFakeOrder,
  saveFakeOrder,
} from "@/app/api/dev-kapital/_store";

export const dynamic = "force-dynamic";

/**
 * Fake HPP outcome. Updates the stored order and redirects the
 * browser back to the merchant hppRedirectUrl with the documented
 * ID/STATUS query hints — which the application must treat as
 * untrusted (its server-side GET verification is the authority).
 */
export async function POST(request: Request): Promise<Response> {
  if (!fakeKapitalEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const password = String(form.get("password") ?? "");
  const action = String(form.get("action") ?? "");
  const order = await readFakeOrder(id);
  if (order === null || order.password !== password) {
    return NextResponse.json({ error: "Invalid order" }, { status: 403 });
  }
  if (action === "pay") {
    order.status = "FullyPaid";
    order.actionId = String(randomInt(1000000, 9999999));
  } else if (action === "decline") {
    order.status = "Declined";
  } else if (action === "cancel") {
    order.status = "Cancelled";
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  await saveFakeOrder(order);
  const redirect = new URL(order.hppRedirectUrl);
  redirect.searchParams.set("ID", order.id);
  redirect.searchParams.set("STATUS", order.status);
  return NextResponse.redirect(redirect.toString(), 303);
}
