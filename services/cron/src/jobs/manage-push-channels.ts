import type { CronOptions } from "cronbake";
import {
  createManagePushChannelsDependencies,
  runManagePushChannels,
  type ManagePushChannelsDependencies,
} from "@keeper.sh/calendar";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import { createRegistrarContext } from "@/utils/push-channel-registrar";

const createDefaultDependencies = async (): Promise<ManagePushChannelsDependencies> => {
  const { database, premiumService, refreshLockRedis, refreshLockStore } = await import(
    "@/context"
  );
  const { default: environment } = await import("@/env");

  return createManagePushChannelsDependencies({
    createRegistrarContext,
    database,
    locks: refreshLockStore,
    negativeCache: refreshLockRedis,
    observe: (fields) => {
      widelog.setFields(fields);
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: true, slug });
    },
    resolvePlan: (userId) => premiumService.getUserPlan(userId),
    webhookPublicUrl: environment.WEBHOOK_PUBLIC_URL ?? null,
  });
};

export default withCronWideEvent({
  async callback() {
    const dependencies = await createDefaultDependencies();
    await runManagePushChannels(dependencies);
  },
  cron: "@every_5_minutes",
  name: import.meta.file,
  overrunProtection: true,
}) satisfies CronOptions;
