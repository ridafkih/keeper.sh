import { Fragment } from "react";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { Heading1 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { TextLink } from "@/components/ui/primitives/text-link";
import { ArticleCard } from "@/features/marketing/components/article-card";
import { ArticleCta } from "@/features/marketing/components/article-cta";
import { siloBreadcrumbs } from "@/lib/content-silo-head";
import { otherContentSilos, type ContentSilo } from "@/lib/content-silos";

export function ContentSiloDirectory({ silo }: { silo: ContentSilo }) {
  const siblings = otherContentSilos(silo);

  return (
    <div className="flex flex-col gap-8 py-16">
      <Breadcrumb items={siloBreadcrumbs(silo)} />
      <header className="flex flex-col gap-1.5">
        <Heading1>{silo.name}</Heading1>
        <Text size="base" tone="muted" className="leading-6">
          {silo.description}
        </Text>
      </header>

      <div className="flex flex-col gap-3">
        {silo.pages.map((page) => (
          <ArticleCard
            key={page.slug}
            blurb={page.metadata.blurb}
            createdAt={page.metadata.createdAt}
            path={`${silo.basePath}/${page.slug}`}
            title={page.metadata.title}
          />
        ))}
      </div>

      <Text size="base" tone="muted" className="leading-6">
        Looking for something else?{" "}
        {siblings.map((sibling, index) => (
          <Fragment key={sibling.id}>
            <TextLink align="left" size="base" to={sibling.basePath}>
              {sibling.name}
            </TextLink>
            {` ${sibling.tagline.toLowerCase()}`}
            {index === siblings.length - 1 ? "." : ", and "}
          </Fragment>
        ))}{" "}
        The{" "}
        <TextLink align="left" size="base" to="/blog">
          blog
        </TextLink>{" "}
        carries the longer walkthroughs, and{" "}
        <TextLink align="left" size="base" to="/compare">
          compare
        </TextLink>{" "}
        puts Keeper.sh next to the other calendar sync tools.
      </Text>

      <ArticleCta />
    </div>
  );
}
