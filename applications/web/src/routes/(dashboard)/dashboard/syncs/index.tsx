import { createFileRoute } from "@tanstack/react-router";
import { SyncsListPanel } from "@/features/syncs/components/syncs-list-panel";

export const Route = createFileRoute("/(dashboard)/dashboard/syncs/")({
  component: SyncsListPanel,
});
