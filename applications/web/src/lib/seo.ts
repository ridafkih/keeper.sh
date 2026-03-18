const SITE_URL = "https://keeper.sh";
const SITE_NAME = "Keeper.sh";

export function canonicalUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

export function jsonLdScript(data: Record<string, unknown>) {
  return { type: "application/ld+json", children: JSON.stringify(data) };
}

export function seoMeta({
  title,
  description,
  path,
  type = "website",
  brandPosition = "after",
}: {
  title: string;
  description: string;
  path: string;
  type?: string;
  brandPosition?: "before" | "after";
}) {
  const fullTitle = brandPosition === "before"
    ? `${SITE_NAME} — ${title}`
    : `${title} · ${SITE_NAME}`;
  return [
    { title: fullTitle },
    { content: description, name: "description" },
    { content: type, property: "og:type" },
    { content: title, property: "og:title" },
    { content: description, property: "og:description" },
    { content: canonicalUrl(path), property: "og:url" },
    { content: SITE_NAME, property: "og:site_name" },
    { content: `${SITE_URL}/open-graph.png`, property: "og:image" },
    { content: "1200", property: "og:image:width" },
    { content: "630", property: "og:image:height" },
    { content: "summary_large_image", name: "twitter:card" },
    { content: title, name: "twitter:title" },
    { content: description, name: "twitter:description" },
    { content: `${SITE_URL}/open-graph.png`, name: "twitter:image" },
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
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/512x512-on-light.png`,
        width: 512,
        height: 512,
      },
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
    image: `${SITE_URL}/open-graph.png`,
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

export function collectionPageSchema(posts: Array<{ slug: string; metadata: { title: string } }>) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_URL}/blog/#collectionpage`,
    name: "Blog",
    url: canonicalUrl("/blog"),
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: canonicalUrl(`/blog/${post.slug}`),
        name: post.metadata.title,
      })),
    },
  };
}

export const authorPersonSchema = {
  "@type": "Person",
  "@id": `${SITE_URL}/#author`,
  name: "Rida F'kih",
  url: "https://rida.dev",
  sameAs: ["https://github.com/ridafkih"],
};

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
    image: `${SITE_URL}/open-graph.png`,
    url,
    datePublished: post.createdAt,
    dateModified: post.updatedAt,
    keywords: post.tags,
    author: authorPersonSchema,
    publisher: { "@id": `${SITE_URL}/#organization` },
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}
