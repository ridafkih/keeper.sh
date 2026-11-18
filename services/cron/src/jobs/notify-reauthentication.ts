import type { CronOptions } from "cronbake";
import { Resend } from "resend";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import { database } from "@/context";
import env from "@/env";
import { resolveReauthenticationEmailConfig, runReauthenticationNotices } from "@/utils/reauthentication-notice";
import type { SendReauthenticationEmail } from "@/utils/reauthentication-notice";

const emailConfig = resolveReauthenticationEmailConfig(env);

const createSender = (resendApiKey: string): SendReauthenticationEmail => {
  const resend = new Resend(resendApiKey);
  return async (email) => {
    const { error } = await resend.emails.send(email);
    if (error) {
      throw new Error(`Resend refused the reconnect email: ${error.message}`);
    }
  };
};

export default withCronWideEvent({
  async callback() {
    if (!emailConfig) {
      widelog.set("reauthentication_email.enabled", false);
      return;
    }
    const result = await runReauthenticationNotices({
      database,
      linkBaseUrl: emailConfig.linkBaseUrl,
      now: new Date(),
      send: createSender(emailConfig.resendApiKey),
      templateId: emailConfig.templateId,
    });
    widelog.set("reauthentication_email.sent_count", result.sent);
    widelog.set("reauthentication_email.failed_count", result.failures.length);
    const [firstFailure] = result.failures;
    if (firstFailure) {
      widelog.errorFields(firstFailure, { slug: "reauthentication-email-failed" });
    }
  },
  cron: "@every_15_minutes",
  name: "notify-reauthentication",
  overrunProtection: true,
}) satisfies CronOptions;
