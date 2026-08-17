export { microsoftCapabilities } from "./capabilities";
export { microsoftLimits } from "./limits";
export type { MicrosoftLimits } from "./limits";

export { createGraphClient } from "./client/graph-client";
export type { FetchImplementation, GraphClientOptions } from "./client/graph-client";
export { createHeldTokenAuthenticationProvider } from "./client/authentication";
export { microsoftPrefer, preferHeaders, preferHeaderValue } from "./client/prefer";

export { createMicrosoftProvider } from "./provider";
export { createMicrosoftContract } from "./contract";
export type { MicrosoftClock, MicrosoftDependencies } from "./dependencies";

export { withinMicrosoftWindow } from "./window/membership";
export { microsoftFingerprintContract } from "./fingerprint";

export { decodeGraphPush, pushRejections } from "./push/receiver";
export type {
  GraphPushClaim,
  GraphPushRequest,
  GraphPushSignal,
  PushRejection,
} from "./push/receiver";
export { clientStateHash, verifyClientState } from "./push/secret";
export { graphLifecycleEvents, lifecycleOutcomeOf } from "./push/lifecycle";
export type { GraphLifecycleEvent, LifecycleOutcome } from "./push/lifecycle";
export type { RichHint } from "./push/resource-data";
export {
  renewalInstantOf,
  staggerOffsetMs,
  subscriptionLifetimeMs,
  subscriptionResources,
} from "./push/profile";
export type { SubscriptionResource } from "./push/profile";
export {
  deleteSubscription,
  listSubscriptions,
  registerSubscription,
  renewSubscription,
  subscriptionScopeOf,
} from "./push/subscription";
export type {
  GraphSubscription,
  SubscriptionRequest,
  SubscriptionScope,
} from "./push/subscription";
export { ownsNotificationUrl, reconcileSubscriptions } from "./push/reconcile";
