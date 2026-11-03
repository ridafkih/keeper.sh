import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/connect/microsoft",
)({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/connect/outlook" });
  },
});
