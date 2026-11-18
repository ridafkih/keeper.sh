import type { SafeFetchOptions } from "./safe-fetch";

interface PrivateResolutionEnvironment {
  BLOCK_PRIVATE_RESOLUTION?: boolean;
  COMMERCIAL_MODE?: boolean;
  PRIVATE_RESOLUTION_WHITELIST?: string;
}

type PrivateResolutionSource = "commercial-mode" | "configured" | "default";

interface PrivateResolutionPolicy {
  options: Pick<SafeFetchOptions, "allowedPrivateHosts" | "blockPrivateResolution">;
  source: PrivateResolutionSource;
}

const parseAllowedPrivateHosts = (whitelist: string | undefined): Set<string> | null => {
  if (!whitelist) {
    return null;
  }

  return new Set(
    whitelist
      .split(",")
      .map((host) => host.trim())
      .filter((host) => host.length > 0),
  );
};

const resolveBlockDecision = (
  environment: PrivateResolutionEnvironment,
): { blockPrivateResolution: boolean; source: PrivateResolutionSource } => {
  if (environment.COMMERCIAL_MODE === true) {
    return { blockPrivateResolution: true, source: "commercial-mode" };
  }
  if (typeof environment.BLOCK_PRIVATE_RESOLUTION === "boolean") {
    return { blockPrivateResolution: environment.BLOCK_PRIVATE_RESOLUTION, source: "configured" };
  }
  return { blockPrivateResolution: false, source: "default" };
};

const resolvePrivateResolutionPolicy = (
  environment: PrivateResolutionEnvironment,
): PrivateResolutionPolicy => {
  const { blockPrivateResolution, source } = resolveBlockDecision(environment);
  const allowedPrivateHosts = parseAllowedPrivateHosts(environment.PRIVATE_RESOLUTION_WHITELIST);

  return {
    options: {
      blockPrivateResolution,
      ...allowedPrivateHosts && { allowedPrivateHosts },
    },
    source,
  };
};

const describePrivateResolutionPolicy = (
  policy: PrivateResolutionPolicy,
): Record<string, boolean | number | string> => ({
  "config.block_private_resolution": policy.options.blockPrivateResolution === true,
  "config.block_private_resolution_source": policy.source,
  "config.private_resolution_whitelist_size": policy.options.allowedPrivateHosts?.size ?? 0,
});

export { describePrivateResolutionPolicy, resolvePrivateResolutionPolicy };
export type { PrivateResolutionEnvironment, PrivateResolutionPolicy, PrivateResolutionSource };
