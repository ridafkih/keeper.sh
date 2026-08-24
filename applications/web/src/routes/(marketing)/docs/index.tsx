import { createFileRoute } from "@tanstack/react-router";
import { ContentSiloDirectory } from "@/features/marketing/components/content-silo-directory";
import { contentSiloDirectoryHead } from "@/lib/content-silo-head";
import { contentSilos } from "@/lib/content-silos";

const silo = contentSilos.docs;

export const Route = createFileRoute("/(marketing)/docs/")({
  component: DocsDirectoryPage,
  head: () => contentSiloDirectoryHead(silo),
});

function DocsDirectoryPage() {
  return <ContentSiloDirectory silo={silo} />;
}
