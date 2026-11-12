import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(dashboard)/dashboard/connect")({
  component: ConnectLayout,
});

function ConnectLayout() {
  return (
    <div className="flex flex-col gap-3">
      <Outlet />
    </div>
  );
}
