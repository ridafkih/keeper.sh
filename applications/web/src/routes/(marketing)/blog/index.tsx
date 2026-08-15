import { createFileRoute } from "@tanstack/react-router";
import { Heading1 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { TextLink } from "@/components/ui/primitives/text-link";
import { ArticleCard } from "@/features/marketing/components/article-card";
import { blogPosts } from "@/lib/blog-posts";
import { jsonLdScript, seoHead, breadcrumbSchema, breadcrumbTrail, collectionPageSchema } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";

const breadcrumbs = breadcrumbTrail({ name: "Blog", path: "/blog" });

export const Route = createFileRoute("/(marketing)/blog/")({
  component: BlogDirectoryPage,
  head: () => seoHead({
    title: "Blog",
    description: "Guides for each calendar provider, comparisons with other sync tools, and how Keeper.sh works.",
    path: "/blog",
    scripts: [
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
      jsonLdScript(collectionPageSchema("/blog", "Blog", blogPosts)),
    ],
  }),
});

function BlogDirectoryPage() {
  return (
    <div className="flex flex-col gap-8 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>Blog</Heading1>
        <Text size="base" tone="muted" className="leading-6">
          Guides for each calendar provider, comparisons with other sync tools, and how Keeper.sh works.
          Weighing Keeper.sh against another tool? Read the{" "}
          <TextLink align="left" size="base" to="/compare">comparison pages</TextLink>.
        </Text>
      </header>

      <div className="flex flex-col gap-3">
        {blogPosts.map((blogPost) => (
          <ArticleCard
            key={blogPost.slug}
            blurb={blogPost.metadata.blurb}
            createdAt={blogPost.metadata.createdAt}
            path={`/blog/${blogPost.slug}`}
            title={blogPost.metadata.title}
          />
        ))}
      </div>
    </div>
  );
}
