import { createFileRoute, Outlet } from "@tanstack/react-router";
import { canonicalUrl } from "@/lib/seo";

export const Route = createFileRoute("/(marketing)/changelog")({
  component: ChangelogRouteLayout,
  head: () => ({
    links: [
      {
        rel: "alternate",
        type: "application/rss+xml",
        title: "Keeper.sh Changelog",
        href: canonicalUrl("/changelog.xml"),
      },
    ],
  }),
});

function ChangelogRouteLayout() {
  return <Outlet />;
}
