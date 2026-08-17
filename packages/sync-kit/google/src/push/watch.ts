import type { calendar_v3 } from "@googleapis/calendar";
import type {
  CalendarKey,
  Instant,
  OperationContext,
  Result,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { RequestSeam } from "../client/request";
import type { GoogleDependencies } from "../dependencies";
import { toProviderFailure } from "../errors/to-provider-failure";
import { googleWatchProfile } from "./profile";

interface WatchRequest {
  readonly calendar: CalendarKey;
  readonly callbackUrl: string;
  readonly token: string;
}

interface WatchChannel {
  readonly channelId: string;
  readonly resourceId: string;
  readonly calendar: CalendarKey;
  readonly expiration: Instant;
}

interface WatchSurroundings {
  readonly dependencies: GoogleDependencies;
  readonly requests: RequestSeam;
}

type StopOutcome = { readonly kind: "stopped" } | { readonly kind: "alreadyGone" };

const watchFailure = (calendar: CalendarKey) =>
  ({ operation: "write", calendar, account: calendar.account, scope: null }) as const;

const expirationOf = (
  channel: calendar_v3.Schema$Channel,
  surroundings: WatchSurroundings,
): Instant => {
  const reported = Number.parseInt(channel.expiration ?? "", 10);
  if (Number.isFinite(reported)) {
    return { kind: "instant", value: new Date(reported).toISOString() };
  }
  const now = Date.parse(surroundings.dependencies.clock.now().value);
  return {
    kind: "instant",
    value: new Date(now + googleWatchProfile.maximumLifetimeMs).toISOString(),
  };
};

const registerWatchChannel = async (
  request: WatchRequest,
  context: OperationContext,
  surroundings: WatchSurroundings,
): Promise<Result<WatchChannel>> => {
  const channelId = surroundings.dependencies.randomId();
  const answered = await surroundings.requests.send("write", context, (signal) =>
    surroundings.dependencies.calendar.events.watch(
      {
        calendarId: request.calendar.calendar.value,
        requestBody: {
          id: channelId,
          type: "web_hook",
          address: request.callbackUrl,
          token: request.token,
        },
      },
      { signal },
    ),
  );
  switch (answered.kind) {
    case "answered": {
      const channel = answered.value.data;
      const { resourceId } = channel;
      if (typeof resourceId !== "string" || resourceId.length === 0) {
        return { ok: false, failure: { kind: "transport", status: null, disposition: "permanent" } };
      }
      return {
        ok: true,
        value: {
          channelId: channel.id ?? channelId,
          resourceId,
          calendar: request.calendar,
          expiration: expirationOf(channel, surroundings),
        },
      };
    }
    case "notAttempted": {
      return { ok: false, failure: { kind: "notAttempted", reason: answered.reason } };
    }
    case "failed": {
      return {
        ok: false,
        failure: toProviderFailure(answered.failure, watchFailure(request.calendar)),
      };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const stopWatchChannel = async (
  channel: WatchChannel,
  context: OperationContext,
  surroundings: WatchSurroundings,
): Promise<Result<StopOutcome>> => {
  const answered = await surroundings.requests.send("write", context, (signal) =>
    surroundings.dependencies.calendar.channels.stop(
      { requestBody: { id: channel.channelId, resourceId: channel.resourceId } },
      { signal },
    ),
  );
  switch (answered.kind) {
    case "answered": {
      return { ok: true, value: { kind: "stopped" } };
    }
    case "notAttempted": {
      return { ok: false, failure: { kind: "notAttempted", reason: answered.reason } };
    }
    case "failed": {
      if (answered.failure.kind === "notFound" || answered.failure.kind === "resourceGone") {
        return { ok: true, value: { kind: "alreadyGone" } };
      }
      return {
        ok: false,
        failure: toProviderFailure(answered.failure, watchFailure(channel.calendar)),
      };
    }
    default: {
      return assertNever(answered);
    }
  }
};

interface RenewedChannel {
  readonly channel: WatchChannel;
  readonly superseded: Result<StopOutcome>;
}

const renewWatchChannel = async (
  channel: WatchChannel,
  request: WatchRequest,
  context: OperationContext,
  surroundings: WatchSurroundings,
): Promise<Result<RenewedChannel>> => {
  const registered = await registerWatchChannel(request, context, surroundings);
  if (!registered.ok) {
    return registered;
  }
  const superseded = await stopWatchChannel(channel, context, surroundings);
  return { ok: true, value: { channel: registered.value, superseded } };
};

export { registerWatchChannel, renewWatchChannel, stopWatchChannel };
export type { RenewedChannel, StopOutcome, WatchChannel, WatchRequest, WatchSurroundings };
