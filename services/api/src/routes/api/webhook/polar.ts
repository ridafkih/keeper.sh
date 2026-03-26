import { WebhookVerificationError, validateEvent } from "@polar-sh/sdk/webhooks";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { database } from "@/context";
import env from "@/env";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { createProductPlanMapping } from "@keeper.sh/premium";
import type { Plan } from "@keeper.sh/data-schemas";

const HTTP_OK = 200;

const productPlanMapping = createProductPlanMapping({
  proProductIds: env.POLAR_PRO_PRODUCT_IDS,
  unlimitedProductIds: env.POLAR_UNLIMITED_PRODUCT_IDS,
});

const upsertActiveSubscription = async (
  userId: string,
  plan: Plan,
  polarSubscriptionId: string,
): Promise<void> => {
  await database
    .insert(userSubscriptionsTable)
    .values({
      plan,
      polarSubscriptionId,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        plan,
        polarSubscriptionId,
      },
      target: userSubscriptionsTable.userId,
    });
};

const clearActiveSubscription = async (
  userId: string,
): Promise<void> => {
  await database
    .insert(userSubscriptionsTable)
    .values({
      polarSubscriptionId: null,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        polarSubscriptionId: null,
      },
      target: userSubscriptionsTable.userId,
    });
};

const handleSubscriptionCreated = async (
  userId: string | null,
  productId: string,
): Promise<Response> => {
  if (!userId) {
    return new Response(null, { status: HTTP_OK });
  }

  const plan = productPlanMapping.resolveProductPlan(productId);
  await upsertActiveSubscription(userId, plan, productId);
  return new Response(null, { status: HTTP_OK });
};

const handleSubscriptionUpdated = async (
  userId: string | null,
  productId: string,
  status: string,
): Promise<Response> => {
  if (!userId) {
    return new Response(null, { status: HTTP_OK });
  }

  if (status === "active" || status === "trialing") {
    const plan = productPlanMapping.resolveProductPlan(productId);
    await upsertActiveSubscription(userId, plan, productId);
  } else {
    await clearActiveSubscription(userId);
  }

  return new Response(null, { status: HTTP_OK });
};

const handleSubscriptionCanceled = async (
  userId: string | null,
): Promise<Response> => {
  if (!userId) {
    return new Response(null, { status: HTTP_OK });
  }

  await clearActiveSubscription(userId);
  return new Response(null, { status: HTTP_OK });
};

const POST = async (request: Request): Promise<Response> => {
  const webhookSecret = env.POLAR_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return ErrorResponse.notImplemented().toResponse();
  }

  const body = await request.text();
  const headers: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }

  try {
    const event = validateEvent(body, headers, webhookSecret);

    widelog.set("operation.type", "webhook");
    widelog.set("webhook.event_type", event.type);
    widelog.set("webhook.subscription_id", event.data.id);

    if (event.type === "subscription.created") {
      const createdUserId = event.data.customer.externalId ?? null;
      if (createdUserId) {
        widelog.set("user.id", createdUserId);
      }
      return handleSubscriptionCreated(
        createdUserId,
        event.data.productId,
      );
    }

    if (event.type === "subscription.updated") {
      const updatedUserId = event.data.customer.externalId ?? null;
      if (updatedUserId) {
        widelog.set("user.id", updatedUserId);
      }
      const plan = productPlanMapping.resolveProductPlan(event.data.productId);
      widelog.set("webhook.resulting_plan", plan);
      return handleSubscriptionUpdated(
        updatedUserId,
        event.data.productId,
        event.data.status,
      );
    }

    if (event.type === "subscription.canceled") {
      const canceledUserId = event.data.customer.externalId ?? null;
      if (canceledUserId) {
        widelog.set("user.id", canceledUserId);
      }
      return handleSubscriptionCanceled(
        canceledUserId,
      );
    }

    return new Response(null, { status: HTTP_OK });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      widelog.errorFields(error, { slug: "webhook-signature-invalid", retriable: false });
      return ErrorResponse.unauthorized().toResponse();
    }
    throw error;
  }
};

export { POST };
