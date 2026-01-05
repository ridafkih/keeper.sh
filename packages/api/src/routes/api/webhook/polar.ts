import type { MaybePromise } from "bun";
import { WebhookVerificationError, validateEvent } from "@polar-sh/sdk/webhooks";
import { WideEvent, emitWideEvent, runWithWideEvent } from "@keeper.sh/log";
import { ErrorResponse } from "../../../utils/responses";
import { database } from "../../../context";
import env from "@keeper.sh/env/api";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";

const HTTP_OK = 200;

const getPlanFromActiveStatus = (active: boolean): "pro" | "free" => {
  if (active) {
    return "pro";
  }
  return "free";
};

const upsertSubscription = async (
  userId: string,
  plan: "free" | "pro",
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

const handleSubscriptionCreated = async (
  event: WideEvent,
  userId: string | null,
  subscriptionId: string,
): Promise<Response> => {
  if (!userId) {
    return new Response(null, { status: HTTP_OK });
  }

  event.set({ userId });
  await upsertSubscription(userId, "pro", subscriptionId);
  return new Response(null, { status: HTTP_OK });
};

const handleSubscriptionUpdated = async (
  event: WideEvent,
  userId: string | null,
  subscriptionId: string,
  isActive: boolean,
): Promise<Response> => {
  if (!userId) {
    return new Response(null, { status: HTTP_OK });
  }

  const plan = getPlanFromActiveStatus(isActive);
  event.set({ subscriptionPlan: plan, userId });
  await upsertSubscription(userId, plan, subscriptionId);
  return new Response(null, { status: HTTP_OK });
};

const handleSubscriptionCanceled = async (
  event: WideEvent,
  userId: string | null,
  subscriptionId: string,
): Promise<Response> => {
  if (!userId) {
    return new Response(null, { status: HTTP_OK });
  }

  event.set({ subscriptionPlan: "free", userId });
  await upsertSubscription(userId, "free", subscriptionId);
  return new Response(null, { status: HTTP_OK });
};

const POST = (request: Request): MaybePromise<Response> => {
  const webhookSecret = env.POLAR_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return ErrorResponse.notImplemented().toResponse();
  }

  const wideEvent = new WideEvent("api");
  wideEvent.set({
    operationName: "polar",
    operationType: "webhook",
  });

  return runWithWideEvent(wideEvent, async () => {
    try {
      const body = await request.text();
      const headers: Record<string, string> = {};
      for (const [key, value] of request.headers.entries()) {
        headers[key] = value;
      }

      const event = validateEvent(body, headers, webhookSecret);
      wideEvent.set({ operationName: `polar:${event.type}` });

      if (event.type === "subscription.created") {
        return handleSubscriptionCreated(
          wideEvent,
          event.data.customer.externalId ?? null,
          event.data.id,
        );
      }

      if (event.type === "subscription.updated") {
        return handleSubscriptionUpdated(
          wideEvent,
          event.data.customer.externalId ?? null,
          event.data.id,
          event.data.status === "active",
        );
      }

      if (event.type === "subscription.canceled") {
        return handleSubscriptionCanceled(
          wideEvent,
          event.data.customer.externalId ?? null,
          event.data.id,
        );
      }

      return new Response(null, { status: HTTP_OK });
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        wideEvent.set({ error: true, errorType: "WebhookVerificationError" });
        return ErrorResponse.unauthorized().toResponse();
      }
      wideEvent.setError(error);
      throw error;
    } finally {
      emitWideEvent(wideEvent.finalize());
    }
  });
};

export { POST };
