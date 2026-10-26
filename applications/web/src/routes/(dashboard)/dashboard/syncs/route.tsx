import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(dashboard)/dashboard/syncs")({
  component: SyncsLayout,
});

function SyncsLayout() {
  return <Outlet />;
}
