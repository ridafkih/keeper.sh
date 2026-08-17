import type {
  CalendarId,
  CalendarKey,
  Instant,
  OperationContext,
  Result,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { graphEmpty, graphJson } from "../client/graph-call";
import type { RequestSeam } from "../client/request";
import type { MicrosoftDependencies } from "../dependencies";
import type { MicrosoftFailure } from "../errors/classify";
import { toProviderFailure } from "../errors/to-provider-failure";
import type { SubscriptionResource } from "./profile";
import { expirationInstantOf, subscriptionLifetimeMs } from "./profile";

interface ProviderAccountId {
  readonly kind: "providerAccountId";
  readonly value: string;
}

interface SubscriptionScope {
  readonly kind: "subscriptionScope";
  readonly account: ProviderAccountId;
  readonly calendar: CalendarId;
}

const scopeRefusals = ["missingProviderAccountId"] as const;
type ScopeRefusal = (typeof scopeRefusals)[number];

type ScopeOutcome =
  | { readonly kind: "scoped"; readonly scope: SubscriptionScope }
  | { readonly kind: "withheld"; readonly reason: ScopeRefusal };

const subscriptionScopeOf = (candidate: {
  readonly providerAccountId: string | null;
  readonly calendar: CalendarId;
}): ScopeOutcome => {
  const named = candidate.providerAccountId;
  if (named === null || named.length === 0) {
    return { kind: "withheld", reason: "missingProviderAccountId" };
  }
  return {
    kind: "scoped",
    scope: {
      kind: "subscriptionScope",
      account: { kind: "providerAccountId", value: named },
      calendar: candidate.calendar,
    },
  };
};

const resourcePathOf = (scope: SubscriptionScope, resource: SubscriptionResource): string =>
  `users/${scope.account.value}/calendars/${scope.calendar.value}/${resource}`;

interface SubscriptionRequest {
  readonly scope: SubscriptionScope;
  readonly resource: SubscriptionResource;
  readonly includeResourceData: boolean;
  readonly notificationUrl: string;
  readonly lifecycleNotificationUrl: string;
  readonly clientState: string;
}

interface GraphSubscription {
  readonly id: string;
  readonly resource: string;
  readonly notificationUrl: string;
  readonly expiration: Instant;
  readonly includesResourceData: boolean;
  readonly createdAt: Instant;
}

interface SubscriptionSurroundings {
  readonly dependencies: MicrosoftDependencies;
  readonly requests: RequestSeam;
}

type DeleteSubscriptionOutcome = { readonly kind: "deleted" } | { readonly kind: "alreadyGone" };

const subscriptionsPath = "subscriptions";
const changeTypes = "created,updated,deleted";

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Reflect.get(value, name);
};

const textAt = (value: unknown, name: string): string | null => {
  const held = readProperty(value, name);
  if (typeof held !== "string" || held.length === 0) {
    return null;
  }
  return held;
};

const resourceSegments = /^users\/([^/]+)\/calendars\/([^/]+)\//;

const calendarKeyOfResource = (resource: string): CalendarKey | null => {
  const matched = resourceSegments.exec(resource);
  if (!matched) {
    return null;
  }
  const account = matched.at(1) ?? null;
  const calendar = matched.at(2) ?? null;
  if (account === null || calendar === null) {
    return null;
  }
  return {
    provider: "microsoft",
    account: { kind: "accountId", value: account },
    calendar: { kind: "calendarId", value: calendar },
  };
};

const mailboxesOfResource = (resource: string): readonly string[] => {
  const key = calendarKeyOfResource(resource);
  if (key === null) {
    return [resource];
  }
  return [key.account.value];
};

const subscriptionFailure = (failure: MicrosoftFailure, resource: string) => {
  const calendar = calendarKeyOfResource(resource);
  return toProviderFailure(failure, {
    operation: "write",
    account: calendar?.account ?? { kind: "accountId", value: resource },
    calendar,
    scope: null,
  });
};

const subscriptionOf = (
  body: unknown,
  fallback: { readonly resource: string; readonly createdAt: Instant },
): GraphSubscription | null => {
  const id = textAt(body, "id");
  const notificationUrl = textAt(body, "notificationUrl");
  const expiration = textAt(body, "expirationDateTime");
  if (id === null || notificationUrl === null || expiration === null) {
    return null;
  }
  return {
    id,
    resource: textAt(body, "resource") ?? fallback.resource,
    notificationUrl,
    expiration: { kind: "instant", value: expiration },
    includesResourceData: readProperty(body, "includeResourceData") === true,
    createdAt: fallback.createdAt,
  };
};

const unreadableSubscription: Result<GraphSubscription> = {
  ok: false,
  failure: { kind: "transport", status: null, disposition: "permanent" },
};

const registerSubscription = async (
  request: SubscriptionRequest,
  context: OperationContext,
  surroundings: SubscriptionSurroundings,
): Promise<Result<GraphSubscription>> => {
  const resource = resourcePathOf(request.scope, request.resource);
  const now = surroundings.dependencies.clock.now();
  const expiration = expirationInstantOf(
    now,
    subscriptionLifetimeMs(request.resource, request.includeResourceData),
    request.resource,
    request.includeResourceData,
  );
  const answered = await surroundings.requests.send<unknown>({
    operation: "write",
    mailboxes: mailboxesOfResource(resource),
    context,
    send: (signal) =>
      graphJson(
        surroundings.dependencies.graph,
        {
          method: "post",
          path: subscriptionsPath,
          body: {
            changeType: changeTypes,
            notificationUrl: request.notificationUrl,
            lifecycleNotificationUrl: request.lifecycleNotificationUrl,
            resource,
            expirationDateTime: expiration.value,
            clientState: request.clientState,
            includeResourceData: request.includeResourceData,
          },
        },
        signal,
      ),
  });
  switch (answered.kind) {
    case "answered": {
      const registered = subscriptionOf(answered.value, { resource, createdAt: now });
      if (registered === null) {
        return unreadableSubscription;
      }
      return { ok: true, value: registered };
    }
    case "failed": {
      return { ok: false, failure: subscriptionFailure(answered.failure, resource) };
    }
    case "notAttempted": {
      return { ok: false, failure: { kind: "notAttempted", reason: answered.reason } };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const renewSubscription = async (
  subscription: GraphSubscription,
  context: OperationContext,
  surroundings: SubscriptionSurroundings,
): Promise<Result<GraphSubscription>> => {
  const now = surroundings.dependencies.clock.now();
  const expiration = expirationInstantOf(
    now,
    subscriptionLifetimeMs("events", subscription.includesResourceData),
    "events",
    subscription.includesResourceData,
  );
  const answered = await surroundings.requests.send<unknown>({
    operation: "write",
    mailboxes: mailboxesOfResource(subscription.resource),
    context,
    send: (signal) =>
      graphJson(
        surroundings.dependencies.graph,
        {
          method: "patch",
          path: `${subscriptionsPath}/${subscription.id}`,
          body: { expirationDateTime: expiration.value },
        },
        signal,
      ),
  });
  switch (answered.kind) {
    case "answered": {
      const renewed = subscriptionOf(answered.value, {
        resource: subscription.resource,
        createdAt: subscription.createdAt,
      });
      if (renewed === null) {
        return unreadableSubscription;
      }
      return { ok: true, value: renewed };
    }
    case "failed": {
      return { ok: false, failure: subscriptionFailure(answered.failure, subscription.resource) };
    }
    case "notAttempted": {
      return { ok: false, failure: { kind: "notAttempted", reason: answered.reason } };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const deleteSubscription = async (
  subscription: GraphSubscription,
  context: OperationContext,
  surroundings: SubscriptionSurroundings,
): Promise<Result<DeleteSubscriptionOutcome>> => {
  const answered = await surroundings.requests.send<null>({
    operation: "write",
    mailboxes: mailboxesOfResource(subscription.resource),
    context,
    send: (signal) =>
      graphEmpty(
        surroundings.dependencies.graph,
        { method: "delete", path: `${subscriptionsPath}/${subscription.id}` },
        signal,
      ),
  });
  switch (answered.kind) {
    case "answered": {
      return { ok: true, value: { kind: "deleted" } };
    }
    case "failed": {
      if (answered.failure.kind === "notFound" || answered.failure.kind === "gone") {
        return { ok: true, value: { kind: "alreadyGone" } };
      }
      return { ok: false, failure: subscriptionFailure(answered.failure, subscription.resource) };
    }
    case "notAttempted": {
      return { ok: false, failure: { kind: "notAttempted", reason: answered.reason } };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const listSubscriptions = async (
  context: OperationContext,
  surroundings: SubscriptionSurroundings,
): Promise<Result<readonly GraphSubscription[]>> => {
  const now = surroundings.dependencies.clock.now();
  const answered = await surroundings.requests.send<unknown>({
    operation: "listCalendars",
    mailboxes: [subscriptionsPath],
    context,
    send: (signal) =>
      graphJson(surroundings.dependencies.graph, { method: "get", path: subscriptionsPath }, signal),
  });
  switch (answered.kind) {
    case "answered": {
      const held = readProperty(answered.value, "value");
      if (!Array.isArray(held)) {
        return { ok: true, value: [] };
      }
      return {
        ok: true,
        value: held.flatMap((entry) => {
          const named = subscriptionOf(entry, {
            resource: textAt(entry, "resource") ?? "",
            createdAt: now,
          });
          if (named === null) {
            return [];
          }
          return [named];
        }),
      };
    }
    case "failed": {
      return { ok: false, failure: subscriptionFailure(answered.failure, subscriptionsPath) };
    }
    case "notAttempted": {
      return { ok: false, failure: { kind: "notAttempted", reason: answered.reason } };
    }
    default: {
      return assertNever(answered);
    }
  }
};

export {
  calendarKeyOfResource,
  deleteSubscription,
  listSubscriptions,
  registerSubscription,
  renewSubscription,
  resourcePathOf,
  scopeRefusals,
  subscriptionScopeOf,
};
export type {
  DeleteSubscriptionOutcome,
  GraphSubscription,
  ProviderAccountId,
  ScopeOutcome,
  ScopeRefusal,
  SubscriptionRequest,
  SubscriptionScope,
  SubscriptionSurroundings,
};
