import { Link } from "@tanstack/react-router";
import { Heading1, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { LinkButton, ButtonText } from "@/components/ui/primitives/button";
import { blogPosts } from "@/lib/blog-posts";

const SUGGESTED_POST_COUNT = 4;

export function MarketingNotFound() {
  const suggestedPosts = blogPosts.slice(0, SUGGESTED_POST_COUNT);

  return (
    <div className="flex flex-col gap-8 py-16">
      <meta name="robots" content="noindex" />
      <header className="flex flex-col gap-1.5">
        <Heading1>Page not found</Heading1>
        <Text size="base" tone="muted" className="leading-6">
          The page you&apos;re looking for doesn&apos;t exist. Head back home, or pick up one of the
          latest posts from the blog.
        </Text>
      </header>

      <div className="flex flex-wrap gap-2">
        <LinkButton to="/" variant="border" size="compact">
          <ButtonText>Go home</ButtonText>
        </LinkButton>
        <LinkButton to="/blog" variant="border" size="compact">
          <ButtonText>Read the blog</ButtonText>
        </LinkButton>
      </div>

      {suggestedPosts.length > 0 && (
        <section className="flex flex-col gap-3">
          <Heading3 as="h2">Latest from the blog</Heading3>
          <div className="flex flex-col gap-3">
            {suggestedPosts.map((blogPost) => (
              <Link
                key={blogPost.slug}
                className="group flex flex-col gap-1 rounded-2xl border border-interactive-border bg-background p-4 shadow-xs transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-5"
                params={{ slug: blogPost.slug }}
                to="/blog/$slug"
              >
                <Heading3 as="h3" className="group-hover:text-foreground-hover">
                  {blogPost.metadata.title}
                </Heading3>
                <Text size="sm" tone="muted" className="line-clamp-2">
                  {blogPost.metadata.blurb}
                </Text>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
