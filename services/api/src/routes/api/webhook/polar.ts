import { Polar } from "@polar-sh/sdk";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { WebhookVerificationError, validateEvent } from "@polar-sh/sdk/webhooks";
import type { Plan } from "@keeper.sh/data-schemas";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { withWideEvent } from "@/utils/middleware";
import { syncPolarSubscription } from "@/utils/polar-subscription-sync";
import { database } from "@/context";
import env from "@/env";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";

const HTTP_OK = 200;

const upsertSubscription = async (
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

const buildPolarClient = (): Polar | null => {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_MODE) {
    return null;
  }
  return new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_MODE,
  });
};

const polarClient = buildPolarClient();

const fetchActiveSubscriptionIds = async (
  client: Polar,
  externalCustomerId: string,
): Promise<string[]> => {
  try {
    const state = await client.customers.getStateExternal({ externalId: externalCustomerId });
    return state.activeSubscriptions.map((subscription) => subscription.id);
  } catch (error) {
    if (error instanceof ResourceNotFound) {
      return [];
    }
    throw error;
  }
};

interface ObservedSubscription {
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  endedAt: Date | null;
}

const observeSubscription = (subscription: ObservedSubscription): void => {
  widelog.set("webhook.subscription_status", subscription.status);
  widelog.set("webhook.cancel_at_period_end", subscription.cancelAtPeriodEnd);
  if (subscription.currentPeriodEnd) {
    widelog.set("webhook.current_period_end", subscription.currentPeriodEnd.toISOString());
  }
  if (subscription.endedAt) {
    widelog.set("webhook.ended_at", subscription.endedAt.toISOString());
  }
};

const POST = withWideEvent(async ({ request }) => {
  const webhookSecret = env.POLAR_WEBHOOK_SECRET;

  if (!webhookSecret || !polarClient) {
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
    widelog.set("webhook.provider", "polar");
    widelog.set("webhook.event_type", event.type);
    widelog.set("webhook.subscription_id", event.data.id);

    if (!event.type.startsWith("subscription.") || !("customer" in event.data)) {
      return new Response(null, { status: HTTP_OK });
    }

    if ("cancelAtPeriodEnd" in event.data) {
      observeSubscription(event.data);
    }

    const externalCustomerId = event.data.customer.externalId ?? null;
    if (externalCustomerId) {
      widelog.set("user.id", externalCustomerId);
    }

    await syncPolarSubscription(
      {
        externalCustomerId,
        subscriptionId: event.data.id,
        type: event.type,
      },
      {
        fetchActiveSubscriptionIds: (customerId) =>
          fetchActiveSubscriptionIds(polarClient, customerId),
        observe: (fields) => {
          for (const [key, value] of Object.entries(fields)) {
            widelog.set(key, value);
          }
        },
        upsertSubscription,
      },
    );

    return new Response(null, { status: HTTP_OK });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      widelog.errorFields(error, { slug: "webhook-signature-invalid", retriable: false });
      return ErrorResponse.unauthorized().toResponse();
    }
    throw error;
  }
});

export { POST };
