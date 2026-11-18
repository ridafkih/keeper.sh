const CHECKOUT_CREATION_PATH = "/api/auth/checkout";
const HTTP_BAD_REQUEST = 400;

type CheckoutCreationStage = "checkout_created" | "checkout_creation_failed";

interface CheckoutCreation {
  productIds: string[];
}

interface CheckoutWebhookData {
  id: string;
  status: string;
  productId: string | null;
  externalCustomerId: string | null;
}

interface SubscriptionWebhookData {
  recurringInterval: string;
  productId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isCheckoutCreation = (pathname: string, method: string): boolean =>
  pathname === CHECKOUT_CREATION_PATH && method === "POST";

const readCheckoutCreation = (body: unknown): CheckoutCreation => {
  if (!isRecord(body) || !Array.isArray(body.products)) {
    return { productIds: [] };
  }
  return {
    productIds: body.products.filter((product): product is string => typeof product === "string"),
  };
};

const resolveCheckoutCreationStage = (status: number): CheckoutCreationStage => {
  if (status >= HTTP_BAD_REQUEST) {
    return "checkout_creation_failed";
  }
  return "checkout_created";
};

const describeCheckoutCreation = (
  creation: CheckoutCreation,
  status: number,
): Record<string, string> => ({
  "billing.funnel_stage": resolveCheckoutCreationStage(status),
  "checkout.product_ids": creation.productIds.join(","),
});

const describeCheckoutWebhook = (checkout: CheckoutWebhookData): Record<string, string> => {
  const fields: Record<string, string> = {
    "billing.funnel_stage": `checkout_${checkout.status}`,
    "checkout.id": checkout.id,
    "checkout.status": checkout.status,
  };
  if (checkout.productId) {
    fields["checkout.product_id"] = checkout.productId;
  }
  if (checkout.externalCustomerId) {
    fields["user.id"] = checkout.externalCustomerId;
  }
  return fields;
};

const describeSubscriptionWebhook = (
  eventType: string,
  subscription: SubscriptionWebhookData,
): Record<string, string> => {
  const fields: Record<string, string> = {
    "subscription.interval": subscription.recurringInterval,
    "subscription.product_id": subscription.productId,
  };
  if (eventType === "subscription.created") {
    fields["billing.funnel_stage"] = "subscription_started";
  }
  return fields;
};

export {
  describeCheckoutCreation,
  describeCheckoutWebhook,
  describeSubscriptionWebhook,
  isCheckoutCreation,
  readCheckoutCreation,
};
export type { CheckoutCreation, CheckoutWebhookData, SubscriptionWebhookData };
