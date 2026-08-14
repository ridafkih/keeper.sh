import { createFileRoute, notFound } from "@tanstack/react-router";
import type { AllowedTags, Components } from "streamdown";
import { Heading1 } from "@/components/ui/primitives/heading";
import { Prose } from "@/components/ui/primitives/prose";
import { TextLink } from "@/components/ui/primitives/text-link";
import { Text } from "@/components/ui/primitives/text";
import { NotFoundState } from "@/components/ui/shells/not-found";
import { ArticleCta } from "@/features/marketing/components/article-cta";
import { MarkdownFaq, MarkdownFaqItem } from "@/features/marketing/components/markdown-faq";
import { findBlogPostBySlug } from "@/lib/blog-posts";
import { formatIsoDate } from "@/utils/date";
import { canonicalUrl, jsonLdScript, seoMeta, blogPostingSchema, breadcrumbSchema, breadcrumbTrail, faqPageSchema } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";

const MARKDOWN_FAQ_TAGS: AllowedTags = {
  faq: [],
  "faq-item": ["question"],
};

const MARKDOWN_FAQ_COMPONENTS = {
  faq: MarkdownFaq,
  "faq-item": MarkdownFaqItem,
} as Components;

const blogPostBreadcrumbs = (title: string, slug: string) =>
  breadcrumbTrail({ name: "Blog", path: "/blog" }, { name: title, path: `/blog/${slug}` });

export const Route = createFileRoute("/(marketing)/blog/$slug")({
  loader: ({ params }) => {
    if (!findBlogPostBySlug(params.slug)) {
      throw notFound();
    }
  },
  component: BlogPostPage,
  notFoundComponent: NotFoundState,
  head: ({ params }) => {
    const blogPost = findBlogPostBySlug(params.slug);
    if (!blogPost) {
      return {
        meta: [
          { title: "Blog Post · Keeper.sh" },
          { content: "noindex", name: "robots" },
        ],
      };
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
          imagePath: blogPost.metadata.image,
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
          imagePath: blogPost.metadata.image,
        })),
        jsonLdScript(breadcrumbSchema(blogPostBreadcrumbs(blogPost.metadata.title, params.slug))),
        ...(blogPost.faq.length > 0
          ? [jsonLdScript(faqPageSchema(postUrl, blogPost.faq))]
          : []),
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
      <Breadcrumb items={blogPostBreadcrumbs(blogPost.metadata.title, slug)} />
      <header className="flex flex-col gap-2">
        <Heading1>{blogPost.metadata.title}</Heading1>
        <div className="flex flex-col">
          <Text size="sm" tone="muted" align="left">
            By{" "}
            <TextLink align="left" size="sm" to="/about" tone="default">
              Rida F&apos;kih
            </TextLink>
            {" · "}{createdDate}
            {showUpdated && <> · Updated {updatedDate}</>}
          </Text>
        </div>
      </header>

      <Prose allowedTags={MARKDOWN_FAQ_TAGS} components={MARKDOWN_FAQ_COMPONENTS}>
        {blogPost.content}
      </Prose>

      <ArticleCta />
    </div>
  );
}
