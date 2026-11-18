import type { PublicRuntimeConfig } from "./runtime-config";

type GoogleTagConfig = Pick<PublicRuntimeConfig, "googleAdsId" | "googleAnalyticsId">;

const getGoogleTagIds = ({ googleAdsId, googleAnalyticsId }: GoogleTagConfig): string[] =>
  [googleAdsId, googleAnalyticsId].filter((id): id is string => id !== null);

export { getGoogleTagIds };
export type { GoogleTagConfig };
