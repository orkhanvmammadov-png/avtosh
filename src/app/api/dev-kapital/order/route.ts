import { randomBytes, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/config/kapital";
import {
  fakeKapitalAuthorized,
  fakeKapitalEnabled,
  saveFakeOrder,
} from "@/app/api/dev-kapital/_store";

export const dynamic = "force-dynamic";

/** Fake Kapital POST /order — mirrors the documented contract. */
export async function POST(request: Request): Promise<Response> {
  if (!fakeKapitalEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!fakeKapitalAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { order?: Record<string, unknown> };
  try {
    body = (await request.json()) as { order?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ errorCode: "InvalidRequest" }, { status: 400 });
  }
  const order = body.order ?? {};
  if (
    order.typeRid !== "Order_SMS" ||
    typeof order.amount !== "string" ||
    typeof order.currency !== "string" ||
    typeof order.hppRedirectUrl !== "string"
  ) {
    return NextResponse.json({ errorCode: "InvalidRequest" }, { status: 400 });
  }
  const id = String(randomInt(100000, 999999));
  const created = {
    id,
    password: randomBytes(8).toString("hex"),
    secret: randomBytes(8).toString("hex"),
    amount: order.amount,
    currency: order.currency,
    language: typeof order.language === "string" ? order.language : "az",
    description: typeof order.description === "string" ? order.description : "",
    hppRedirectUrl: order.hppRedirectUrl,
    status: "Preparing",
    actionId: null,
  };
  await saveFakeOrder(created);
  return NextResponse.json({
    order: {
      id: Number(id),
      password: created.password,
      secret: created.secret,
      status: created.status,
      hppUrl: `${appOrigin()}/api/dev-kapital/hpp`,
      cvv2AuthStatus: "None",
    },
  });
}
