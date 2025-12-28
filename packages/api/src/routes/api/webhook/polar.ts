import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";
import { log } from "@keeper.sh/log";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { database } from "../../../context";
import env from "@keeper.sh/env/api";

const upsertSubscription = async (
  userId: string,
  plan: "free" | "pro",
  polarSubscriptionId: string,
) => {
  log.trace("upsertSubscription for user '%s' started", userId);
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
  log.trace("upsertSubscription for user '%s' complete", userId);
};

export async function POST(request: Request): Promise<Response> {
  const webhookSecret = env.POLAR_WEBHOOK_SECRET;

  if (!webhookSecret) {
    log.warn("POLAR_WEBHOOK_SECRET not configured");
    return new Response(null, { status: 501 });
  }

  try {
    const body = await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const event = validateEvent(body, headers, webhookSecret);

    log.trace("polar webhook '%s' started", event.type);

    if (event.type === "subscription.created") {
      const userId = event.data.customer.externalId;
      if (!userId) {
        log.warn("subscription created without external customer ID");
        log.trace("polar webhook 'subscription.created' complete");
        return new Response(null, { status: 200 });
      }

      await upsertSubscription(userId, "pro", event.data.id);
      log.info(
        "subscription '%s' created for user '%s'",
        event.data.id,
        userId,
      );
      log.trace("polar webhook 'subscription.created' complete");
    }

    if (event.type === "subscription.updated") {
      const userId = event.data.customer.externalId;
      if (!userId) {
        log.warn("subscription updated without external customer ID");
        log.trace("polar webhook 'subscription.updated' complete");
        return new Response(null, { status: 200 });
      }

      const isActive = event.data.status === "active";
      await upsertSubscription(
        userId,
        isActive ? "pro" : "free",
        event.data.id,
      );
      log.info(
        "subscription '%s' updated for user '%s' (active: %s)",
        event.data.id,
        userId,
        isActive,
      );
      log.trace("polar webhook 'subscription.updated' complete");
    }

    if (event.type === "subscription.canceled") {
      const userId = event.data.customer.externalId;
      if (!userId) {
        log.warn("subscription canceled without external customer ID");
        log.trace("polar webhook 'subscription.canceled' complete");
        return new Response(null, { status: 200 });
      }

      await upsertSubscription(userId, "free", event.data.id);
      log.info(
        "subscription '%s' canceled for user '%s'",
        event.data.id,
        userId,
      );
      log.trace("polar webhook 'subscription.canceled' complete");
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      log.warn("polar webhook verification failed");
      return new Response(null, { status: 403 });
    }
    log.error({ error }, "polar webhook error");
    throw error;
  }
}
