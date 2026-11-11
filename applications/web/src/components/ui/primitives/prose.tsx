import { Streamdown, type AllowedTags, type Components } from "streamdown";
import type { ContentImage } from "@/lib/blog-posts";
import { markdownComponents } from "./markdown-component-map";
import { ContentImagesContext } from "./content-images-context";

export function Prose({
  children,
  allowedTags,
  components,
  images = [],
}: {
  children: string;
  allowedTags?: AllowedTags;
  components?: Components;
  images?: ContentImage[];
}) {
  return (
    <article className="flex flex-col gap-2">
      <ContentImagesContext value={images}>
        <Streamdown
          allowedTags={allowedTags}
          components={{ ...markdownComponents, ...components }}
        >
          {children}
        </Streamdown>
      </ContentImagesContext>
    </article>
  );
}
