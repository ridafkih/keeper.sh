import {
  registerGoogleWatchChannel,
  renewGoogleWatchChannel,
  stopGoogleWatchChannel,
} from "../../providers/google/push/watch-channel";
import {
  deregisterOutlookSubscription,
  listOutlookSubscriptions,
  registerOutlookSubscription,
  renewOutlookSubscription,
} from "../../providers/outlook/push/subscription";
import { resolveAffectedCalendarIds } from "./push-channel";
import { GOOGLE_PUSH_PROFILE, OUTLOOK_PUSH_PROFILE } from "./push-provider-profile";
import type { SourcePushRegistrar } from "./push-channel";

const googlePushRegistrar: SourcePushRegistrar = {
  ...GOOGLE_PUSH_PROFILE,
  deregister: stopGoogleWatchChannel,
  register: registerGoogleWatchChannel,
  renew: renewGoogleWatchChannel,
  resolveAffectedCalendarIds,
};

const outlookPushRegistrar: SourcePushRegistrar = {
  ...OUTLOOK_PUSH_PROFILE,
  deregister: deregisterOutlookSubscription,
  list: listOutlookSubscriptions,
  register: registerOutlookSubscription,
  renew: renewOutlookSubscription,
  resolveAffectedCalendarIds,
};

const PUSH_REGISTRARS: Record<string, SourcePushRegistrar> = {
  google: googlePushRegistrar,
  outlook: outlookPushRegistrar,
};

const resolvePushRegistrar = (provider: string): SourcePushRegistrar | null =>
  PUSH_REGISTRARS[provider] ?? null;

export { resolvePushRegistrar };
