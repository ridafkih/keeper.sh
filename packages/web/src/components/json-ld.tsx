import type { FC } from "react";

const SITE_URL = "https://keeper.sh";

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Keeper",
  url: SITE_URL,
  logo: `${SITE_URL}/icon.svg`,
  description:
    "Simple, open-source calendar syncing. Aggregate events from multiple calendars into one anonymized feed.",
  sameAs: ["https://github.com/ridafkih/keeper.sh"],
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Keeper",
  url: SITE_URL,
  description:
    "Simple, open-source calendar syncing. Aggregate events from multiple calendars into one anonymized feed. Push events to one or many calendars.",
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Keeper",
  applicationCategory: "ProductivityApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description:
    "Open-source calendar synchronization service that aggregates events from multiple calendars into one anonymized feed.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Person",
    name: "Rida F'kih",
    url: "https://rida.dev",
  },
};

export const JsonLd: FC = () => (
  <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
    />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
    />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
    />
  </>
);
