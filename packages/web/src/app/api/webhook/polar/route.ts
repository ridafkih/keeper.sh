import { Webhooks } from "@polar-sh/nextjs";
import { log } from "@keeper.sh/log";
import { database } from "@keeper.sh/database";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { NextResponse } from "next/server";

const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET;

async function upsertSubscription(
  userId: string,
  plan: "free" | "pro",
  polarSubscriptionId: string,
) {
  log.trace("upsertSubscription for user '%s' started", userId);
  await database
    .insert(userSubscriptionsTable)
    .values({
      userId,
      plan,
      polarSubscriptionId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userSubscriptionsTable.userId,
      set: {
        plan,
        polarSubscriptionId,
        updatedAt: new Date(),
      },
    });
  log.trace("upsertSubscription for user '%s' complete", userId);
}

const fallback = () => new NextResponse(null, { status: 501 });

const handler = POLAR_WEBHOOK_SECRET
  ? Webhooks({
      webhookSecret: POLAR_WEBHOOK_SECRET,
      onPayload: async (payload) => {
        log.trace("polar webhook '%s' started", payload.type);
      },
      onSubscriptionCreated: async (payload) => {
        const userId = payload.data.customer.externalId;
        if (!userId) {
          log.warn("subscription created without external customer ID");
          log.trace("polar webhook 'subscription.created' complete");
          return;
        }

        await upsertSubscription(userId, "pro", payload.data.id);
        log.info(
          "subscription '%s' created for user '%s'",
          payload.data.id,
          userId,
        );
        log.trace("polar webhook 'subscription.created' complete");
      },
      onSubscriptionUpdated: async (payload) => {
        const userId = payload.data.customer.externalId;
        if (!userId) {
          log.warn("subscription updated without external customer ID");
          log.trace("polar webhook 'subscription.updated' complete");
          return;
        }

        const isActive = payload.data.status === "active";
        await upsertSubscription(
          userId,
          isActive ? "pro" : "free",
          payload.data.id,
        );
        log.info(
          "subscription '%s' updated for user '%s' (active: %s)",
          payload.data.id,
          userId,
          isActive,
        );
        log.trace("polar webhook 'subscription.updated' complete");
      },
      onSubscriptionCanceled: async (payload) => {
        const userId = payload.data.customer.externalId;
        if (!userId) {
          log.warn("subscription canceled without external customer ID");
          log.trace("polar webhook 'subscription.canceled' complete");
          return;
        }

        await upsertSubscription(userId, "free", payload.data.id);
        log.info(
          "subscription '%s' canceled for user '%s'",
          payload.data.id,
          userId,
        );
        log.trace("polar webhook 'subscription.canceled' complete");
      },
    })
  : undefined;

export const POST = POLAR_WEBHOOK_SECRET ? handler : fallback;
