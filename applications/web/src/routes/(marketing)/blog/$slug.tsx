import { createFileRoute, notFound } from "@tanstack/react-router";
import { Streamdown } from "streamdown";
import { Heading1 } from "@/components/ui/primitives/heading";
import { markdownComponents } from "@/components/ui/primitives/markdown-component-map";
import { Text } from "@/components/ui/primitives/text";
import { BlogPostCta } from "@/features/blog/components/blog-post-cta";
import { findBlogPostBySlug, formatIsoDate } from "@/lib/blog-posts";
import { canonicalUrl, jsonLdScript, seoMeta, blogPostingSchema, breadcrumbSchema } from "@/lib/seo";

export const Route = createFileRoute("/(marketing)/blog/$slug")({
  component: BlogPostPage,
  head: ({ params }) => {
    const blogPost = findBlogPostBySlug(params.slug);
    if (!blogPost) {
      return { meta: [{ title: "Blog Post · Keeper.sh" }] };
    }

    const postUrl = `/blog/${params.slug}`;
    return {
      links: [{ rel: "canonical", href: canonicalUrl(postUrl) }],
      meta: [
        ...seoMeta({
          title: blogPost.metadata.title,
          description: blogPost.metadata.description,
          path: postUrl,
          type: "article",
        }),
        { content: blogPost.metadata.tags.join(", "), name: "keywords" },
        { content: blogPost.metadata.createdAt, property: "article:published_time" },
        { content: blogPost.metadata.updatedAt, property: "article:modified_time" },
        ...blogPost.metadata.tags.map((tag) => ({
          content: tag,
          property: "article:tag",
        })),
      ],
      scripts: [
        jsonLdScript(blogPostingSchema({
          title: blogPost.metadata.title,
          description: blogPost.metadata.description,
          slug: params.slug,
          createdAt: blogPost.metadata.createdAt,
          updatedAt: blogPost.metadata.updatedAt,
          tags: blogPost.metadata.tags,
        })),
        jsonLdScript(breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: blogPost.metadata.title, path: postUrl },
        ])),
      ],
    };
  },
});

function BlogPostPage() {
  const { slug } = Route.useParams();
  const blogPost = findBlogPostBySlug(slug);
  if (!blogPost) {
    throw notFound();
  }

  const createdDate = formatIsoDate(blogPost.metadata.createdAt);
  const updatedDate = formatIsoDate(blogPost.metadata.updatedAt);
  const showUpdated = blogPost.metadata.updatedAt !== blogPost.metadata.createdAt;

  return (
    <div className="flex flex-col gap-6 py-16">
      <header className="flex flex-col gap-2">
        <Heading1>{blogPost.metadata.title}</Heading1>
        <div className="flex flex-col">
          <Text size="sm" tone="muted" align="left">
            By{" "}
            <a href="https://rida.dev" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
              Rida F'kih
            </a>
            {" · "}{createdDate}
            {showUpdated && <> · Updated {updatedDate}</>}
          </Text>
        </div>
      </header>

      <article className="flex flex-col gap-2">
        <Streamdown components={markdownComponents}>
          {blogPost.content}
        </Streamdown>
      </article>

      <BlogPostCta />
    </div>
  );
}
