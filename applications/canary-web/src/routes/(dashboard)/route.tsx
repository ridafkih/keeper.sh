import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(dashboard)")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh px-6 py-12">
      <div className="flex flex-col gap-3 w-full max-w-sm">
        <Outlet />
      </div>
    </div>
  );
}
