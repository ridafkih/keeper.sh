import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(dashboard)/dashboard/rules")({
  component: RulesLayout,
});

function RulesLayout() {
  return <Outlet />;
}
