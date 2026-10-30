import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type, type Type } from "arktype";

const titledCard = type({
  "+": "reject",
  title: "string >= 1",
  description: "string >= 1",
});

const faqItem = type({
  "+": "reject",
  question: "string >= 1",
  answer: "string >= 1",
});

const homeSchema = type({
  "+": "reject",
  seo: { "+": "reject", title: "string >= 1", description: "string >= 1" },
  hero: { "+": "reject", heading: "string >= 1", body: "string >= 1", cta: "string >= 1" },
  features: {
    "+": "reject",
    sync: titledCard,
    providers: titledCard,
    details: titledCard,
    agents: titledCard,
    openSource: { "+": "reject", title: "string >= 1", description: "string >= 1", linkLabel: "string >= 1" },
  },
  howItWorks: { "+": "reject", heading: "string >= 1", subheading: "string >= 1" },
  testimonials: { "+": "reject", heading: "string >= 1", subheading: "string >= 1" },
  pricing: {
    "+": "reject",
    heading: "string >= 1",
    subheadingLead: "string >= 1",
    subheadingLinkLabel: "string >= 1",
  },
  articles: {
    "+": "reject",
    heading: "string >= 1",
    bodyLead: "string >= 1",
    blogLinkLabel: "string >= 1",
    bodyAnd: "string >= 1",
    compareLinkLabel: "string >= 1",
  },
  faq: { "+": "reject", heading: "string >= 1", bodyLead: "string >= 1", items: faqItem.array() },
  cta: {
    "+": "reject",
    heading: "string >= 1",
    body: "string >= 1",
    primaryLabel: "string >= 1",
    secondaryLabel: "string >= 1",
  },
});

const featuresSchema = type({
  "+": "reject",
  seo: { "+": "reject", title: "string >= 1", description: "string >= 1" },
  header: { "+": "reject", heading: "string >= 1" },
  cards: type({ "+": "reject", id: "string >= 1", title: "string >= 1", body: "string >= 1" }).array(),
  howItWorks: { "+": "reject", heading: "string >= 1", subheading: "string >= 1" },
  cta: {
    "+": "reject",
    heading: "string >= 1",
    body: "string >= 1",
    primaryLabel: "string >= 1",
    secondaryLabel: "string >= 1",
  },
});

const pricingSchema = type({
  "+": "reject",
  seo: { "+": "reject", title: "string >= 1", description: "string >= 1" },
  header: { "+": "reject", heading: "string >= 1", body: "string >= 1" },
  faq: { "+": "reject", heading: "string >= 1", items: faqItem.array() },
});

const planCopy = type({
  "+": "reject",
  name: "string >= 1",
  description: "string >= 1",
  features: "(string >= 1)[]",
});

const plansSchema = type({ "+": "reject", free: planCopy, pro: planCopy });

const pricingPlansSchema = type({
  "+": "reject",
  plans: type({
    "+": "reject",
    id: "string >= 1",
    name: "string >= 1",
    price: "string >= 1",
    period: "string >= 1",
    description: "string >= 1",
    ctaLabel: "string >= 1",
  }).array(),
  features: type({
    "+": "reject",
    id: "string >= 1",
    label: "string >= 1",
    "free?": "string >= 1",
    "pro?": "string >= 1",
    "highlight?": { "+": "reject", "free?": "string >= 1", "pro?": "string >= 1" },
  }).array(),
});

const howItWorksSchema = type({
  "+": "reject",
  steps: type({
    "+": "reject",
    id: "string >= 1",
    title: "string >= 1",
    body: "string >= 1",
    "note?": "string >= 1",
  }).array(),
});

const aboutSchema = type({
  "+": "reject",
  seo: { "+": "reject", title: "string >= 1", description: "string >= 1", schemaDescription: "string >= 1" },
  header: { "+": "reject", heading: "string >= 1" },
  personDescription: "string >= 1",
  sections: {
    "+": "reject",
    who: {
      "+": "reject",
      title: "string >= 1",
      intro: "string >= 1",
      linksLead: "string >= 1",
      blogLinkLabel: "string >= 1",
      afterBlog: "string >= 1",
      afterGithub: "string >= 1",
      end: "string >= 1",
    },
    why: {
      "+": "reject",
      title: "string >= 1",
      p1: "string >= 1",
      p2: "string >= 1",
      p3Lead: "string >= 1",
      p3LinkLabel: "string >= 1",
      p3End: "string >= 1",
    },
    code: {
      "+": "reject",
      title: "string >= 1",
      p1Lead: "string >= 1",
      p1LinkLabel: "string >= 1",
      p1End: "string >= 1",
      p2: "string >= 1",
      p3Lead: "string >= 1",
      p3LinkLabel: "string >= 1",
      p3End: "string >= 1",
    },
    support: {
      "+": "reject",
      title: "string >= 1",
      lead: "string >= 1",
      issuesLinkLabel: "string >= 1",
      afterIssues: "string >= 1",
    },
  },
  cta: {
    "+": "reject",
    heading: "string >= 1",
    body: "string >= 1",
    primaryLabel: "string >= 1",
    secondaryLabel: "string >= 1",
  },
});

const supportSchema = type({
  "+": "reject",
  seo: { "+": "reject", title: "string >= 1", description: "string >= 1", schemaName: "string >= 1" },
  header: { "+": "reject", heading: "string >= 1" },
  sections: {
    "+": "reject",
    getHelp: {
      "+": "reject",
      title: "string >= 1",
      emailLead: "string >= 1",
      afterEmail: "string >= 1",
      issuesLead: "string >= 1",
      issuesLinkLabel: "string >= 1",
      afterIssues: "string >= 1",
    },
    quickAnswers: {
      "+": "reject",
      title: "string >= 1",
      updateTiming: faqItem,
      missingEvent: {
        "+": "reject",
        question: "string >= 1",
        lead: "string >= 1",
        guideLinkLabel: "string >= 1",
        afterGuide: "string >= 1",
        guidesLinkLabel: "string >= 1",
        end: "string >= 1",
      },
      privacy: faqItem,
      providers: faqItem,
      docsLead: "string >= 1",
      docsLinkLabel: "string >= 1",
      afterDocs: "string >= 1",
    },
    plansBilling: {
      "+": "reject",
      title: "string >= 1",
      lead: "string >= 1",
      limitsLinkLabel: "string >= 1",
      afterLimits: "string >= 1",
      billing: "string >= 1",
    },
    accountData: {
      "+": "reject",
      title: "string >= 1",
      delete: "string >= 1",
      exportLead: "string >= 1",
      afterEmail: "string >= 1",
      privacyLinkLabel: "string >= 1",
      afterPrivacy: "string >= 1",
      termsLinkLabel: "string >= 1",
      end: "string >= 1",
    },
  },
});

const selfHostingSchema = type({
  "+": "reject",
  seo: { "+": "reject", title: "string >= 1", description: "string >= 1" },
  header: { "+": "reject", heading: "string >= 1" },
  cards: type({ "+": "reject", id: "string >= 1", title: "string >= 1", body: "string >= 1" }).array(),
  setup: {
    "+": "reject",
    heading: "string >= 1",
    subheading: "string >= 1",
    need: { "+": "reject", title: "string >= 1", body: "string >= 1", note: "string >= 1" },
    do: { "+": "reject", title: "string >= 1", body: "string >= 1", linkLabel: "string >= 1" },
  },
  faq: { "+": "reject", heading: "string >= 1", items: faqItem.array() },
  cta: {
    "+": "reject",
    heading: "string >= 1",
    body: "string >= 1",
    primaryLabel: "string >= 1",
    secondaryLabel: "string >= 1",
  },
});

const icsViewerSchema = type({
  "+": "reject",
  seo: { "+": "reject", title: "string >= 1", description: "string >= 1" },
  header: { "+": "reject", heading: "string >= 1" },
  howRead: { "+": "reject", heading: "string >= 1", body: "string >= 1" },
  faq: { "+": "reject", heading: "string >= 1", items: faqItem.array() },
  cta: { "+": "reject", title: "string >= 1", body: "string >= 1" },
});

const icsGeneratorSchema = type({
  "+": "reject",
  seo: { "+": "reject", title: "string >= 1", description: "string >= 1" },
  header: { "+": "reject", heading: "string >= 1" },
  writes: { "+": "reject", heading: "string >= 1", body: "string >= 1" },
  faq: { "+": "reject", heading: "string >= 1", items: faqItem.array() },
  cta: { "+": "reject", title: "string >= 1", body: "string >= 1" },
});

const softwareSchemaSchema = type({
  "+": "reject",
  description: "string >= 1",
  offers: { "+": "reject", free: "string >= 1", proMonthly: "string >= 1", proYearly: "string >= 1" },
});

export type HomeCopy = typeof homeSchema.infer;
export type FeaturesCopy = typeof featuresSchema.infer;
export type PricingCopy = typeof pricingSchema.infer;
export type PlansCopy = typeof plansSchema.infer;
export type PricingPlansCopy = typeof pricingPlansSchema.infer;
export type HowItWorksCopy = typeof howItWorksSchema.infer;
export type AboutCopy = typeof aboutSchema.infer;
export type SupportCopy = typeof supportSchema.infer;
export type SelfHostingCopy = typeof selfHostingSchema.infer;
export type IcsViewerCopy = typeof icsViewerSchema.infer;
export type IcsGeneratorCopy = typeof icsGeneratorSchema.infer;
export type SoftwareSchemaCopy = typeof softwareSchemaSchema.infer;

export interface MarketingCopy {
  home: HomeCopy;
  features: FeaturesCopy;
  pricing: PricingCopy;
  plans: PlansCopy;
  pricingPlans: PricingPlansCopy;
  howItWorks: HowItWorksCopy;
  about: AboutCopy;
  support: SupportCopy;
  selfHosting: SelfHostingCopy;
  icsViewer: IcsViewerCopy;
  icsGenerator: IcsGeneratorCopy;
  softwareSchema: SoftwareSchemaCopy;
}

function readSurface<T>(directory: string, name: string, schema: Type<T>): T {
  const filePath = join(directory, `${name}.json`);

  if (!existsSync(filePath)) {
    throw new Error(`Marketing copy "${name}.json" is missing from ${directory}.`);
  }

  const result = schema(JSON.parse(readFileSync(filePath, "utf-8")));

  if (result instanceof type.errors) {
    throw new Error(`Invalid marketing copy in ${name}.json: ${result.summary}`);
  }

  return result as T;
}

export function processMarketingDirectory(directory: string): MarketingCopy {
  return {
    home: readSurface(directory, "home", homeSchema),
    features: readSurface(directory, "features", featuresSchema),
    pricing: readSurface(directory, "pricing", pricingSchema),
    plans: readSurface(directory, "plans", plansSchema),
    pricingPlans: readSurface(directory, "pricing-plans", pricingPlansSchema),
    howItWorks: readSurface(directory, "how-it-works", howItWorksSchema),
    about: readSurface(directory, "about", aboutSchema),
    support: readSurface(directory, "support", supportSchema),
    selfHosting: readSurface(directory, "self-hosting", selfHostingSchema),
    icsViewer: readSurface(directory, "ics-viewer", icsViewerSchema),
    icsGenerator: readSurface(directory, "ics-generator", icsGeneratorSchema),
    softwareSchema: readSurface(directory, "software-schema", softwareSchemaSchema),
  };
}
