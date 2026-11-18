import {
  describePrivateResolutionPolicy,
  resolvePrivateResolutionPolicy,
} from "@keeper.sh/calendar/private-resolution-policy";
import type { SafeFetchOptions } from "@keeper.sh/calendar/safe-fetch";
import { PROVIDER_INGEST_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import env from "@/env";
import { context, widelog } from "@/utils/logging";

const privateResolutionPolicy = resolvePrivateResolutionPolicy(env);

const safeFetchOptions: SafeFetchOptions = {
  ...privateResolutionPolicy.options,
  timeoutMs: PROVIDER_INGEST_REQUEST_TIMEOUT_MS,
};

const reportPrivateResolutionPolicy = (): void => {
  context(() => {
    widelog.set("operation.name", "private-resolution-policy");
    widelog.set("operation.type", "lifecycle");
    widelog.setFields(describePrivateResolutionPolicy(privateResolutionPolicy));
    widelog.set("outcome", "success");
    widelog.flush();
  });
};

export { reportPrivateResolutionPolicy, safeFetchOptions };
