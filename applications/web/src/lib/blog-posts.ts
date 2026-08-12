// @ts-expect-error - virtual module provided by plugins/blog.ts
import { blogPosts as processedPosts } from "virtual:blog-posts";

export interface BlogPostMetadata {
  blurb: string;
  createdAt: string;
  description: string;
  image?: string;
  slug?: string;
  tags: string[];
  title: string;
  updatedAt: string;
}

export interface BlogPostFaqEntry {
  answer: string;
  question: string;
}

export interface BlogPost {
  content: string;
  faq: BlogPostFaqEntry[];
  metadata: BlogPostMetadata;
  slug: string;
}

export const blogPosts: BlogPost[] = processedPosts;

export function findBlogPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((blogPost) => blogPost.slug === slug);
}
