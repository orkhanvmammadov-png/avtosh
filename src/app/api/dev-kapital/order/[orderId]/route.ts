import { NextResponse } from "next/server";
import {
  fakeKapitalAuthorized,
  fakeKapitalEnabled,
  readFakeOrder,
} from "@/app/api/dev-kapital/_store";

export const dynamic = "force-dynamic";

/** Fake Kapital GET /order/{id} — the verification authority. */
export async function GET(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  if (!fakeKapitalEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!fakeKapitalAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { orderId } = await context.params;
  const order = await readFakeOrder(orderId);
  if (order === null) {
    return NextResponse.json({ errorCode: "OrderNotFound" }, { status: 404 });
  }
  return NextResponse.json({
    order: {
      id: Number(order.id),
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      description: order.description,
      trans: order.actionId === null ? [] : [{ actionId: order.actionId }],
    },
  });
}
