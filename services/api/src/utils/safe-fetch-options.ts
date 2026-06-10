import type { SafeFetchOptions } from "@keeper.sh/calendar/safe-fetch";
import env from "@/env";

const parseSafeFetchOptions = (): SafeFetchOptions => {
  const options: SafeFetchOptions = {
    blockPrivateResolution: env.BLOCK_PRIVATE_RESOLUTION === true,
  };

  if (env.PRIVATE_RESOLUTION_WHITELIST) {
    const hosts = env.PRIVATE_RESOLUTION_WHITELIST
      .split(",")
      .map((host) => host.trim())
      .filter((host) => host.length > 0);

    options.allowedPrivateHosts = new Set(hosts);
  }

  return options;
};

const safeFetchOptions = parseSafeFetchOptions();

export { safeFetchOptions };
