import { createFileRoute, Link } from "@tanstack/react-router";
import { Heading1, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { blogPosts, formatIsoDate } from "@/lib/blog-posts";
import { canonicalUrl, jsonLdScript, seoMeta, breadcrumbSchema, collectionPageSchema } from "@/lib/seo";

const BLOG_ILLUSTRATION_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, transparent 0 14px, var(--color-illustration-stripe) 14px 15px)",
} as const;

export const Route = createFileRoute("/(marketing)/blog/")({
  component: BlogDirectoryPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/blog") }],
    meta: seoMeta({
      title: "Blog",
      description: "Product updates, engineering deep-dives, and calendar syncing tips from the Keeper.sh team.",
      path: "/blog",
    }),
    scripts: [
      jsonLdScript(breadcrumbSchema([
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
      ])),
      jsonLdScript(collectionPageSchema(blogPosts)),
    ],
  }),
});

function BlogDirectoryPage() {
  return (
    <div className="flex flex-col gap-8 py-16">
      <header className="flex flex-col gap-1.5">
        <Heading1>Blog</Heading1>
        <Text size="base" tone="muted" className="leading-6">
          Product updates, engineering deep-dives, and calendar syncing tips from the Keeper.sh team.
        </Text>
      </header>

      <div className="flex flex-col gap-3">
        {blogPosts.map((blogPost) => (
          <Link
            key={blogPost.slug}
            className="group block overflow-hidden rounded-2xl border border-interactive-border bg-background shadow-xs transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            params={{ slug: blogPost.slug }}
            to="/blog/$slug"
          >
            <article className="grid grid-cols-1 sm:grid-cols-3 sm:items-stretch">
              <div
                className="bg-background h-28 sm:col-span-1 sm:h-full"
                style={BLOG_ILLUSTRATION_STYLE}
                role="presentation"
              />
              <div className="flex flex-col gap-1 p-4 md:p-5 sm:col-span-2">
                <Heading3 as="h2" className="group-hover:text-foreground-hover">
                  {blogPost.metadata.title}
                </Heading3>
                <Text size="xs" tone="muted" className="opacity-75">
                  Created {formatIsoDate(blogPost.metadata.createdAt)}
                </Text>
                <Text size="sm" tone="muted" className="line-clamp-3">
                  {blogPost.metadata.blurb}
                </Text>
              </div>
            </article>
          </Link>
        ))}
      </div>
    </div>
  );
}
