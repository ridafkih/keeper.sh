import { recordUserSignUpAttribution } from "@keeper.sh/database";
import { SIGN_UP_ATTRIBUTION_FIELDS } from "@keeper.sh/data-schemas";
import type { SignUpAttribution } from "@keeper.sh/data-schemas";
import { context, widelog } from "./logging";
import { labelFailure } from "./error-labelling";

const SIGN_UP_ATTRIBUTION_EVENT_FIELDS: Record<keyof SignUpAttribution, string> = {
  landingPath: "signup.landing_path",
  referrerOrigin: "signup.referrer_origin",
  utmCampaign: "signup.utm_campaign",
  utmMedium: "signup.utm_medium",
  utmSource: "signup.utm_source",
};

const describeSignUpAttribution = (attribution: SignUpAttribution | null): Record<string, string | boolean> => {
  const fields: Record<string, string | boolean> = { "signup.attributed": attribution !== null };
  if (!attribution) {
    return fields;
  }
  for (const field of SIGN_UP_ATTRIBUTION_FIELDS) {
    const value = attribution[field];
    if (value) {
      fields[SIGN_UP_ATTRIBUTION_EVENT_FIELDS[field]] = value;
    }
  }
  return fields;
};

const storeSignUpAttribution = async (userId: string, attribution: SignUpAttribution): Promise<void> => {
  try {
    const { database } = await import("@/context");
    await recordUserSignUpAttribution(database, userId, attribution);
    widelog.set("signup.attribution_stored", true);
  } catch (error) {
    widelog.set("signup.attribution_stored", false);
    labelFailure(error, { slug: "sign-up-attribution-record-failed" });
  }
};

const noteUserCreated = (userId: string, attribution: SignUpAttribution | null): Promise<void> =>
  context(async () => {
    widelog.set("operation.name", "user.created");
    widelog.set("operation.type", "lifecycle");
    widelog.set("user.id", userId);
    widelog.setFields(describeSignUpAttribution(attribution));
    if (attribution) {
      await storeSignUpAttribution(userId, attribution);
    }
    widelog.set("outcome", "success");
    widelog.flush();
  });

export { describeSignUpAttribution, noteUserCreated };
