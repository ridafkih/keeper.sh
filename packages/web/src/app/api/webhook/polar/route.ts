import { Webhooks } from "@polar-sh/nextjs";
import { log } from "@keeper.sh/log";

const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET;

export const POST = POLAR_WEBHOOK_SECRET
  ? Webhooks({
      webhookSecret: POLAR_WEBHOOK_SECRET,
      onPayload: async (payload) => {
        log.info("polar webhook event '%s' received", payload.type);
      },
      onSubscriptionCreated: async (payload) => {
        log.info("subscription '%s' created", payload.data.id);
      },
      onSubscriptionUpdated: async (payload) => {
        log.info("subscription '%s' updated", payload.data.id);
      },
      onSubscriptionCanceled: async (payload) => {
        log.info("subscription '%s' canceled", payload.data.id);
      },
    })
  : undefined;
