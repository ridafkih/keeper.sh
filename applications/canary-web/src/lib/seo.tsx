const SITE_URL = "https://keeper.sh";
const SITE_NAME = "Keeper.sh";

export function canonicalUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function CanonicalLink({ path }: { path: string }) {
  return <link rel="canonical" href={canonicalUrl(path)} />;
}

export function seoMeta({
  title,
  description,
  path,
  type = "website",
}: {
  title: string;
  description: string;
  path: string;
  type?: string;
}) {
  return [
    { title: `${title} · ${SITE_NAME}` },
    { content: description, name: "description" },
    { content: type, property: "og:type" },
    { content: title, property: "og:title" },
    { content: description, property: "og:description" },
    { content: canonicalUrl(path), property: "og:url" },
    { content: SITE_NAME, property: "og:site_name" },
    { content: "summary", name: "twitter:card" },
    { content: title, name: "twitter:title" },
    { content: description, name: "twitter:description" },
  ];
}

export const organizationSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/keeper.svg`,
      sameAs: ["https://github.com/ridafkih/keeper.sh"],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export function breadcrumbSchema(
  items: Array<{ name: string; path: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: canonicalUrl(item.path),
    })),
  };
}

export function webPageSchema(name: string, description: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${canonicalUrl(path)}/#webpage`,
    name,
    description,
    url: canonicalUrl(path),
    isPartOf: { "@id": `${SITE_URL}/#website` },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function softwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: SITE_NAME,
    description:
      "Open-source calendar event syncing tool. Synchronize events between your personal, work, business and school calendars.",
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "USD",
        description:
          "For users that just want to get basic calendar syncing up and running.",
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: "5.00",
        priceCurrency: "USD",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "5.00",
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
        description:
          "For power users who want minutely syncs and unlimited calendars.",
      },
    ],
    provider: { "@id": `${SITE_URL}/#organization` },
  };
}

export function blogPostingSchema(post: {
  title: string;
  description: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}) {
  const url = canonicalUrl(`/blog/${post.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}/#blogposting`,
    headline: post.title,
    description: post.description,
    url,
    datePublished: post.createdAt,
    dateModified: post.updatedAt,
    keywords: post.tags,
    author: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}
