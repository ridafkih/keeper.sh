import { createFileRoute, Outlet } from "@tanstack/react-router";
import { canonicalUrl } from "@/lib/seo";

export const Route = createFileRoute("/(marketing)/blog")({
  component: BlogRouteLayout,
  head: () => ({
    links: [
      {
        rel: "alternate",
        type: "application/rss+xml",
        title: "Keeper.sh Blog",
        href: canonicalUrl("/rss.xml"),
      },
    ],
  }),
});

function BlogRouteLayout() {
  return <Outlet />;
}
