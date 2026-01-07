import type { FC } from "react";
import { SITE_URL } from "@/config/site";

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  description:
    "Simple, open-source calendar syncing. Aggregate events from multiple calendars into one anonymized feed.",
  logo: `${SITE_URL}/icon.svg`,
  name: "Keeper",
  sameAs: ["https://github.com/ridafkih/keeper.sh"],
  url: SITE_URL,
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  description:
    "Simple, open-source calendar syncing. Aggregate events from multiple calendars into one anonymized feed. Push events to one or many calendars.",
  name: "Keeper",
  url: SITE_URL,
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  applicationCategory: "ProductivityApplication",
  author: {
    "@type": "Person",
    name: "Rida F'kih",
    url: "https://rida.dev",
  },
  description:
    "Open-source calendar synchronization service that aggregates events from multiple calendars into one anonymized feed.",
  name: "Keeper",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  operatingSystem: "Web",
  url: SITE_URL,
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
