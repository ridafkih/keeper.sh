import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(dashboard)/dashboard/ical")({
  component: ICalLayout,
});

function ICalLayout() {
  return <Outlet />;
}
