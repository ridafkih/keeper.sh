import type { PublicRuntimeConfig } from "@/lib/runtime-config";
import {
  noContentSecurityPolicySources,
  type ContentSecurityPolicySources,
} from "./content-security-policy-sources";

const visitorsNowScriptHost = "https://cdn.visitors.now";

const visitorsNowSources: ContentSecurityPolicySources = {
  script: [visitorsNowScriptHost],
  img: [],
  connect: [visitorsNowScriptHost, "https://e.visitors.now"],
  frame: [],
};

const resolveVisitorsNowSources = (
  config: Pick<PublicRuntimeConfig, "visitorsNowToken">,
): ContentSecurityPolicySources => {
  if (config.visitorsNowToken === null) return noContentSecurityPolicySources;
  return visitorsNowSources;
};

export { resolveVisitorsNowSources };
