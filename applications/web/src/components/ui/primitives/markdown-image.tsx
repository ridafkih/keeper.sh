import { use, type JSX } from "react";
import { ContentImagesContext } from "./content-images-context";

type MarkdownImageProps = JSX.IntrinsicElements["img"] & {
  node?: unknown;
};

export function MarkdownImage({ alt, src }: MarkdownImageProps) {
  const images = use(ContentImagesContext);
  const image = images.find((candidate) => candidate.src === src);

  return (
    <img
      alt={alt}
      className="my-4 block h-auto max-w-full rounded-2xl border border-interactive-border"
      decoding="async"
      height={image?.height}
      loading="lazy"
      src={src}
      width={image?.width}
    />
  );
}
