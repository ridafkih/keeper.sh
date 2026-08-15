import { createFileRoute, notFound } from "@tanstack/react-router";
import { NotFoundState } from "@/components/ui/shells/not-found";
import { ContentSiloPage } from "@/features/marketing/components/content-silo-page";
import { contentSiloPageHead } from "@/lib/content-silo-head";
import { contentSilos, findSiloPageBySlug } from "@/lib/content-silos";

const silo = contentSilos.recipes;

export const Route = createFileRoute("/(marketing)/recipes/$slug")({
  loader: ({ params }) => {
    if (!findSiloPageBySlug(silo, params.slug)) {
      throw notFound();
    }
  },
  component: RecipesPage,
  notFoundComponent: NotFoundState,
  head: ({ params }) => contentSiloPageHead(silo, params.slug),
});

function RecipesPage() {
  const { slug } = Route.useParams();

  return <ContentSiloPage silo={silo} slug={slug} />;
}
