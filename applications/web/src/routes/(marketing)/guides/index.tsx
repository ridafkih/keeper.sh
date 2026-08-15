import { createFileRoute } from "@tanstack/react-router";
import { ContentSiloDirectory } from "@/features/marketing/components/content-silo-directory";
import { contentSiloDirectoryHead } from "@/lib/content-silo-head";
import { contentSilos } from "@/lib/content-silos";

const silo = contentSilos.guides;

export const Route = createFileRoute("/(marketing)/guides/")({
  component: GuidesDirectoryPage,
  head: () => contentSiloDirectoryHead(silo),
});

function GuidesDirectoryPage() {
  return <ContentSiloDirectory silo={silo} />;
}
