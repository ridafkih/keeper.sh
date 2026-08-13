import { parseOutlookPushNotification, readGraphValidationToken } from "@keeper.sh/calendar";
import { withWideEvent } from "@/utils/middleware";
import {
  ACCEPTED_STATUS,
  handlePushWebhook,
  type PushWebhookDependencies,
  type PushWebhookRouteContext,
} from "@/utils/push-notifications/handle-webhook";
import { createPushWebhookDependencies } from "@/utils/push-notifications/pending-ingest";

const OUTLOOK_PUSH_PROVIDER = "outlook";

const handleOutlookPushWebhook = (
  context: PushWebhookRouteContext,
  dependencies: PushWebhookDependencies,
): Promise<Response> => handlePushWebhook(context, dependencies, {
  acceptedStatus: ACCEPTED_STATUS,
  enforceResourceId: false,
  parse: parseOutlookPushNotification,
  provider: OUTLOOK_PUSH_PROVIDER,
  readValidationToken: readGraphValidationToken,
});

const POST = withWideEvent(async ({ request }) =>
  handleOutlookPushWebhook(
    { request },
    await createPushWebhookDependencies(OUTLOOK_PUSH_PROVIDER),
  ));

export { handleOutlookPushWebhook, POST };
