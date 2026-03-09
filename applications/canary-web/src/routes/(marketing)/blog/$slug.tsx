import { createFileRoute, notFound } from "@tanstack/react-router";
import { Streamdown } from "streamdown";
import { Heading1 } from "../../../components/ui/primitives/heading";
import { markdownComponents } from "../../../components/ui/primitives/markdown-component-map";
import { Text } from "../../../components/ui/primitives/text";
import { BlogPostCta } from "../../../features/blog/components/blog-post-cta";
import { findBlogPostBySlug, formatIsoDate } from "../../../lib/blog-posts";

export const Route = createFileRoute("/(marketing)/blog/$slug")({
  component: BlogPostPage,
  head: ({ params }) => {
    const blogPost = findBlogPostBySlug(params.slug);
    if (!blogPost) {
      return { meta: [{ title: "Blog Post · Keeper" }] };
    }

    return {
      meta: [
        { title: `${blogPost.metadata.title} · Keeper` },
        { content: blogPost.metadata.description, name: "description" },
        { content: blogPost.metadata.tags.join(", "), name: "keywords" },
        { content: "article", property: "og:type" },
        { content: blogPost.metadata.title, property: "og:title" },
        { content: blogPost.metadata.description, property: "og:description" },
        { content: blogPost.metadata.createdAt, property: "article:published_time" },
        { content: blogPost.metadata.updatedAt, property: "article:modified_time" },
        ...blogPost.metadata.tags.map((tag) => ({
          content: tag,
          property: "article:tag",
        })),
      ]
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
  const updatedDate = blogPost.metadata.updatedAt === blogPost.metadata.createdAt
    ? null
    : formatIsoDate(blogPost.metadata.updatedAt);

  return (
    <div className="flex flex-col gap-6 py-16">
      <header className="flex flex-col gap-2">
        <Heading1>{blogPost.metadata.title}</Heading1>
        <Text size="sm" tone="muted" align="left">
          Created {createdDate}
          {updatedDate ? ` · Updated ${updatedDate}` : ""}
        </Text>
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
