import { describe, expect, it } from "vitest";

import realWebhook from "./__fixtures__/order-paid-webhook.json" with { type: "json" };
import { eventNameFrom, orderIdsFrom, shopIdFrom, type ShopwareWebhookBody } from "./webhooks";

const REAL = realWebhook as ShopwareWebhookBody;

describe("against the real Shopware 6.7 payload", () => {
  it("is the paid event we subscribed to", () => {
    expect(eventNameFrom(REAL)).toBe("state_enter.order_transaction.state.paid");
  });

  it("finds the shop id", () => {
    expect(shopIdFrom(REAL)).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("extracts exactly one order id from payload.order", () => {
    const ids = orderIdsFrom(REAL);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("confirms the inline order lacks a billing address, so a fetch is required", () => {
    // This is why the connector cannot work from the webhook payload alone:
    // the billing address decides the destination country and the recipient.
    const order = (REAL.data?.payload as { order?: Record<string, unknown> })?.order;
    expect(order).toBeDefined();
    expect(order?.billingAddress ?? null).toBeNull();
  });
});

describe("orderIdsFrom — other shapes", () => {
  it("reads a bare entity payload", () => {
    expect(orderIdsFrom({ data: { payload: { id: "o-1" } } })).toEqual(["o-1"]);
  });

  it("reads an array payload", () => {
    expect(orderIdsFrom({ data: { payload: [{ order: { id: "o-1" } }, { order: { id: "o-2" } }] } }))
      .toEqual(["o-1", "o-2"]);
  });

  it("prefers payload.order.id over a sibling id", () => {
    expect(orderIdsFrom({ data: { payload: { id: "tx-1", order: { id: "o-1" } } } })).toEqual(["o-1"]);
  });

  it("falls back to an orderId reference", () => {
    expect(orderIdsFrom({ data: { payload: { orderId: "o-9" } } })).toEqual(["o-9"]);
  });

  it("accepts entityId and primaryKey aliases", () => {
    expect(orderIdsFrom({ data: { payload: { entityId: "o-7" } } })).toEqual(["o-7"]);
    expect(orderIdsFrom({ data: { payload: { primaryKey: "o-8" } } })).toEqual(["o-8"]);
  });

  it("skips entries with no usable id", () => {
    expect(orderIdsFrom({ data: { payload: [{ order: { id: "o-1" } }, { foo: "bar" }] } })).toEqual(["o-1"]);
  });

  it("is empty rather than throwing when there is no payload", () => {
    expect(orderIdsFrom({})).toEqual([]);
    expect(orderIdsFrom({ data: { payload: null } })).toEqual([]);
  });
});

describe("shopIdFrom", () => {
  it("is null when absent, so the caller rejects rather than guesses", () => {
    expect(shopIdFrom({})).toBeNull();
    expect(shopIdFrom({ source: { shopId: "" } })).toBeNull();
  });
});
