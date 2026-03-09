import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(marketing)/blog")({
  component: BlogRouteLayout,
});

function BlogRouteLayout() {
  return <Outlet />;
}
