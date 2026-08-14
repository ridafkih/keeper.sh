import { findSiloPageBySlug, type ContentSilo } from "./content-silos";
import {
  blogPostingSchema,
  breadcrumbSchema,
  breadcrumbTrail,
  canonicalUrl,
  collectionPageSchema,
  faqPageSchema,
  jsonLdScript,
  seoMeta,
} from "./seo";

export function siloBreadcrumbs(silo: ContentSilo) {
  return breadcrumbTrail({ name: silo.name, path: silo.basePath });
}

export function siloPageBreadcrumbs(silo: ContentSilo, title: string, slug: string) {
  return breadcrumbTrail(
    { name: silo.name, path: silo.basePath },
    { name: title, path: `${silo.basePath}/${slug}` },
  );
}

export function contentSiloDirectoryHead(silo: ContentSilo) {
  return {
    links: [{ rel: "canonical", href: canonicalUrl(silo.basePath) }],
    meta: seoMeta({
      title: `${silo.name} — ${silo.tagline}`,
      description: silo.description,
      path: silo.basePath,
    }),
    scripts: [
      jsonLdScript(breadcrumbSchema(siloBreadcrumbs(silo))),
      jsonLdScript(collectionPageSchema(silo.basePath, silo.name, silo.pages)),
    ],
  };
}

export function contentSiloPageHead(silo: ContentSilo, slug: string) {
  const page = findSiloPageBySlug(silo, slug);
  if (!page) {
    return {
      meta: [
        { title: `${silo.name} · Keeper.sh` },
        { content: "noindex", name: "robots" },
      ],
    };
  }

  const pagePath = `${silo.basePath}/${slug}`;
  return {
    links: [{ rel: "canonical", href: canonicalUrl(pagePath) }],
    meta: [
      ...seoMeta({
        title: page.metadata.title,
        description: page.metadata.description,
        path: pagePath,
        type: "article",
        imagePath: page.metadata.image,
      }),
      { content: page.metadata.tags.join(", "), name: "keywords" },
      { content: page.metadata.createdAt, property: "article:published_time" },
      { content: page.metadata.updatedAt, property: "article:modified_time" },
    ],
    scripts: [
      jsonLdScript(blogPostingSchema({
        title: page.metadata.title,
        description: page.metadata.description,
        path: pagePath,
        createdAt: page.metadata.createdAt,
        updatedAt: page.metadata.updatedAt,
        tags: page.metadata.tags,
        imagePath: page.metadata.image,
      })),
      jsonLdScript(breadcrumbSchema(siloPageBreadcrumbs(silo, page.metadata.title, slug))),
      ...(page.faq.length > 0 ? [jsonLdScript(faqPageSchema(pagePath, page.faq))] : []),
    ],
  };
}
