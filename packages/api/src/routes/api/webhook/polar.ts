import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";
import {
  WideEvent,
  runWithWideEvent,
  emitWideEvent,
} from "@keeper.sh/log";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { database } from "../../../context";
import env from "@keeper.sh/env/api";

const upsertSubscription = async (
  userId: string,
  plan: "free" | "pro",
  polarSubscriptionId: string,
) => {
  await database
    .insert(userSubscriptionsTable)
    .values({
      userId,
      plan,
      polarSubscriptionId,
    })
    .onConflictDoUpdate({
      target: userSubscriptionsTable.userId,
      set: {
        plan,
        polarSubscriptionId,
      },
    });
};

const handleSubscriptionCreated = async (
  event: WideEvent,
  userId: string | undefined,
  subscriptionId: string,
) => {
  if (!userId) {
    return new Response(null, { status: 200 });
  }

  event.set({ userId });
  await upsertSubscription(userId, "pro", subscriptionId);
  return new Response(null, { status: 200 });
};

const handleSubscriptionUpdated = async (
  event: WideEvent,
  userId: string | undefined,
  subscriptionId: string,
  isActive: boolean,
) => {
  if (!userId) {
    return new Response(null, { status: 200 });
  }

  event.set({ userId, subscriptionPlan: isActive ? "pro" : "free" });
  await upsertSubscription(userId, isActive ? "pro" : "free", subscriptionId);
  return new Response(null, { status: 200 });
};

const handleSubscriptionCanceled = async (
  event: WideEvent,
  userId: string | undefined,
  subscriptionId: string,
) => {
  if (!userId) {
    return new Response(null, { status: 200 });
  }

  event.set({ userId, subscriptionPlan: "free" });
  await upsertSubscription(userId, "free", subscriptionId);
  return new Response(null, { status: 200 });
};

export async function POST(request: Request): Promise<Response> {
  const webhookSecret = env.POLAR_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return new Response(null, { status: 501 });
  }

  const wideEvent = new WideEvent("api");
  wideEvent.set({
    operationType: "webhook",
    operationName: "polar",
  });

  return runWithWideEvent(wideEvent, async () => {
    try {
      const body = await request.text();
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const event = validateEvent(body, headers, webhookSecret);
      wideEvent.set({ operationName: `polar:${event.type}` });

      if (event.type === "subscription.created") {
        return handleSubscriptionCreated(
          wideEvent,
          event.data.customer.externalId ?? undefined,
          event.data.id,
        );
      }

      if (event.type === "subscription.updated") {
        return handleSubscriptionUpdated(
          wideEvent,
          event.data.customer.externalId ?? undefined,
          event.data.id,
          event.data.status === "active",
        );
      }

      if (event.type === "subscription.canceled") {
        return handleSubscriptionCanceled(
          wideEvent,
          event.data.customer.externalId ?? undefined,
          event.data.id,
        );
      }

      return new Response(null, { status: 200 });
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        wideEvent.set({ error: true, errorType: "WebhookVerificationError" });
        return new Response(null, { status: 403 });
      }
      wideEvent.setError(error);
      throw error;
    } finally {
      emitWideEvent(wideEvent.finalize());
    }
  });
}
