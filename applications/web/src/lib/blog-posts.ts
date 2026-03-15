// @ts-expect-error - virtual module provided by plugins/blog.ts
import { blogPosts as processedPosts } from "virtual:blog-posts";

export interface BlogPostMetadata {
  blurb: string;
  createdAt: string;
  description: string;
  slug?: string;
  tags: string[];
  title: string;
  updatedAt: string;
}

export interface BlogPost {
  content: string;
  metadata: BlogPostMetadata;
  slug: string;
}

export const blogPosts: BlogPost[] = processedPosts;

export function findBlogPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((blogPost) => blogPost.slug === slug);
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function formatIsoDate(isoDate: string): string {
  const [yearPart, monthPart, dayPart] = isoDate.split("-");
  const monthName = monthNames[Number(monthPart) - 1];
  return `${monthName} ${Number(dayPart)}, ${yearPart}`;
}
