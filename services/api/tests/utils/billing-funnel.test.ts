import { describe, expect, it } from "vitest";
import {
  describeCheckoutCreation,
  describeCheckoutWebhook,
  describeSubscriptionWebhook,
  isCheckoutCreation,
  readCheckoutCreation,
} from "@/utils/billing-funnel";

describe("the billing funnel", () => {
  it("recognises only a POST to the checkout endpoint as a checkout being created", () => {
    expect(isCheckoutCreation("/api/auth/checkout", "POST")).toBe(true);
    expect(isCheckoutCreation("/api/auth/checkout", "GET")).toBe(false);
    expect(isCheckoutCreation("/api/auth/customer/state", "POST")).toBe(false);
  });

  it("records which products a created checkout was for", () => {
    const creation = readCheckoutCreation({ products: ["product-yearly"], redirect: false });

    expect(describeCheckoutCreation(creation, 200)).toEqual({
      "billing.funnel_stage": "checkout_created",
      "checkout.product_ids": "product-yearly",
    });
  });

  it("records a checkout that could not be created", () => {
    const creation = readCheckoutCreation({ products: ["product-monthly"] });

    expect(describeCheckoutCreation(creation, 500)["billing.funnel_stage"]).toBe(
      "checkout_creation_failed",
    );
  });

  it("records no products for a body that names none", () => {
    expect(readCheckoutCreation(null)).toEqual({ productIds: [] });
    expect(readCheckoutCreation({ products: "product-monthly" })).toEqual({ productIds: [] });
  });

  it("records each checkout status Polar reports, with the user it belongs to", () => {
    expect(
      describeCheckoutWebhook({
        externalCustomerId: "user-1",
        id: "checkout-1",
        productId: "product-yearly",
        status: "succeeded",
      }),
    ).toEqual({
      "billing.funnel_stage": "checkout_succeeded",
      "checkout.id": "checkout-1",
      "checkout.product_id": "product-yearly",
      "checkout.status": "succeeded",
      "user.id": "user-1",
    });
  });

  it("marks a new subscription as the funnel's completion, with its interval", () => {
    expect(
      describeSubscriptionWebhook("subscription.created", {
        productId: "product-yearly",
        recurringInterval: "year",
      }),
    ).toEqual({
      "billing.funnel_stage": "subscription_started",
      "subscription.interval": "year",
      "subscription.product_id": "product-yearly",
    });
  });

  it("leaves the funnel stage off later subscription changes", () => {
    expect(
      describeSubscriptionWebhook("subscription.updated", {
        productId: "product-monthly",
        recurringInterval: "month",
      }),
    ).toEqual({
      "subscription.interval": "month",
      "subscription.product_id": "product-monthly",
    });
  });
});
