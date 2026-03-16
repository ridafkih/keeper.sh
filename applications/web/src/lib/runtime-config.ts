interface PublicRuntimeConfig {
  commercialMode: boolean;
  googleAdsConversionLabel: string | null;
  googleAdsId: string | null;
  polarProMonthlyProductId: string | null;
  polarProYearlyProductId: string | null;
  visitorsNowToken: string | null;
}

interface RuntimeConfigSource {
  commercialMode?: boolean | null;
  googleAdsConversionLabel?: string | null;
  googleAdsId?: string | null;
  polarProMonthlyProductId?: string | null;
  polarProYearlyProductId?: string | null;
  visitorsNowToken?: string | null;
}

const normalizeOptionalValue = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  return value.length > 0 ? value : null;
};

const getServerPublicRuntimeConfig = (
  environment: Record<string, string | undefined>,
): PublicRuntimeConfig => ({
  commercialMode: environment.COMMERCIAL_MODE === "true",
  googleAdsConversionLabel: normalizeOptionalValue(
    environment.VITE_GOOGLE_ADS_CONVERSION_LABEL,
  ),
  googleAdsId: normalizeOptionalValue(environment.VITE_GOOGLE_ADS_ID),
  polarProMonthlyProductId: normalizeOptionalValue(environment.POLAR_PRO_MONTHLY_PRODUCT_ID),
  polarProYearlyProductId: normalizeOptionalValue(environment.POLAR_PRO_YEARLY_PRODUCT_ID),
  visitorsNowToken: normalizeOptionalValue(environment.VITE_VISITORS_NOW_TOKEN),
});

const getWindowPublicRuntimeConfig = (): RuntimeConfigSource => {
  if (typeof window === "undefined") {
    return {};
  }

  return window.__KEEPER_RUNTIME_CONFIG__ ?? {};
};

const resolvePublicRuntimeConfig = (source: RuntimeConfigSource): PublicRuntimeConfig => ({
  commercialMode: source.commercialMode === true,
  googleAdsConversionLabel: normalizeOptionalValue(source.googleAdsConversionLabel),
  googleAdsId: normalizeOptionalValue(source.googleAdsId),
  polarProMonthlyProductId: normalizeOptionalValue(source.polarProMonthlyProductId),
  polarProYearlyProductId: normalizeOptionalValue(source.polarProYearlyProductId),
  visitorsNowToken: normalizeOptionalValue(source.visitorsNowToken),
});

const getPublicRuntimeConfig = (): PublicRuntimeConfig => resolvePublicRuntimeConfig(
  getWindowPublicRuntimeConfig(),
);

const serializePublicRuntimeConfig = (config: PublicRuntimeConfig): string =>
  JSON.stringify(config)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026");

declare global {
  interface Window {
    __KEEPER_RUNTIME_CONFIG__?: RuntimeConfigSource;
  }
}

export {
  getPublicRuntimeConfig,
  getServerPublicRuntimeConfig,
  resolvePublicRuntimeConfig,
  serializePublicRuntimeConfig,
};
export type { PublicRuntimeConfig, RuntimeConfigSource };
