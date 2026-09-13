import { describe, expect, it } from "vitest";

import { shopIdFrom, transactionIdsFrom, type ShopwareWebhookBody } from "./webhooks";

describe("transactionIdsFrom", () => {
  it("reads a single object payload", () => {
    const body: ShopwareWebhookBody = { data: { payload: { id: "tx-1" } } };
    expect(transactionIdsFrom(body)).toEqual(["tx-1"]);
  });

  it("reads an array payload, which other Shopware versions send", () => {
    const body: ShopwareWebhookBody = { data: { payload: [{ id: "tx-1" }, { id: "tx-2" }] } };
    expect(transactionIdsFrom(body)).toEqual(["tx-1", "tx-2"]);
  });

  it("accepts entityId as an alias", () => {
    expect(transactionIdsFrom({ data: { payload: { entityId: "tx-9" } } })).toEqual(["tx-9"]);
  });

  it("accepts primaryKey, which entity.written events use", () => {
    expect(transactionIdsFrom({ data: { payload: { primaryKey: "tx-7" } } })).toEqual(["tx-7"]);
  });

  it("skips entries with no usable id rather than emitting undefined", () => {
    const body: ShopwareWebhookBody = { data: { payload: [{ id: "tx-1" }, { foo: "bar" }] } };
    expect(transactionIdsFrom(body)).toEqual(["tx-1"]);
  });

  it("is empty for a payload-less body instead of throwing", () => {
    expect(transactionIdsFrom({})).toEqual([]);
  });

  it("is empty for a null payload", () => {
    expect(transactionIdsFrom({ data: { payload: null } })).toEqual([]);
  });
});

describe("shopIdFrom", () => {
  it("reads the shop id from source", () => {
    expect(shopIdFrom({ source: { shopId: "shop-1" } })).toBe("shop-1");
  });

  it("is null when absent, so the caller rejects rather than guesses", () => {
    expect(shopIdFrom({})).toBeNull();
    expect(shopIdFrom({ source: { shopId: "" } })).toBeNull();
  });
});
