import { createFileRoute, notFound } from "@tanstack/react-router";
import { MarketingNotFound } from "@/features/marketing/components/marketing-not-found";
import { notFoundHead } from "@/lib/seo";

/**
 * Catches every unmatched path so the not-found page renders inside the
 * marketing layout, with its header, footer and navigation. The loader throws
 * so the response keeps its 404 status.
 */
export const Route = createFileRoute("/(marketing)/$")({
  loader: () => {
    throw notFound();
  },
  component: MarketingNotFound,
  notFoundComponent: MarketingNotFound,
  head: notFoundHead,
});
