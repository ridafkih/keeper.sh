import { HTTP_STATUS } from "@keeper.sh/constants";
import { parseGooglePushNotification } from "@keeper.sh/calendar";
import { withWideEvent } from "@/utils/middleware";
import {
  handlePushWebhook,
  type PushWebhookDependencies,
  type PushWebhookRouteContext,
} from "@/utils/push-notifications/handle-webhook";
import { createPushWebhookDependencies } from "@/utils/push-notifications/pending-ingest";

const GOOGLE_PUSH_PROVIDER = "google";

const handleGooglePushWebhook = (
  context: PushWebhookRouteContext,
  dependencies: PushWebhookDependencies,
): Promise<Response> => handlePushWebhook(context, dependencies, {
  acceptedStatus: HTTP_STATUS.OK,
  enforceResourceId: true,
  parse: parseGooglePushNotification,
  provider: GOOGLE_PUSH_PROVIDER,
});

const POST = withWideEvent(async ({ request }) =>
  handleGooglePushWebhook(
    { request },
    await createPushWebhookDependencies(GOOGLE_PUSH_PROVIDER),
  ));

export { handleGooglePushWebhook, POST };
