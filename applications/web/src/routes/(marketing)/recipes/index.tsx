import { createFileRoute } from "@tanstack/react-router";
import { ContentSiloDirectory } from "@/features/marketing/components/content-silo-directory";
import { contentSiloDirectoryHead } from "@/lib/content-silo-head";
import { contentSilos } from "@/lib/content-silos";

const silo = contentSilos.recipes;

export const Route = createFileRoute("/(marketing)/recipes/")({
  component: RecipesDirectoryPage,
  head: () => contentSiloDirectoryHead(silo),
});

function RecipesDirectoryPage() {
  return <ContentSiloDirectory silo={silo} />;
}
