interface ContentSecurityPolicySources {
  script: readonly string[];
  img: readonly string[];
  connect: readonly string[];
  frame: readonly string[];
}

const noContentSecurityPolicySources: ContentSecurityPolicySources = {
  script: [],
  img: [],
  connect: [],
  frame: [],
};

const uniqueSources = (sources: readonly string[]): string[] => [...new Set(sources)];

const mergeContentSecurityPolicySources = (
  sourceSets: readonly ContentSecurityPolicySources[],
): ContentSecurityPolicySources => ({
  script: uniqueSources(sourceSets.flatMap((sourceSet) => sourceSet.script)),
  img: uniqueSources(sourceSets.flatMap((sourceSet) => sourceSet.img)),
  connect: uniqueSources(sourceSets.flatMap((sourceSet) => sourceSet.connect)),
  frame: uniqueSources(sourceSets.flatMap((sourceSet) => sourceSet.frame)),
});

export { mergeContentSecurityPolicySources, noContentSecurityPolicySources };
export type { ContentSecurityPolicySources };
