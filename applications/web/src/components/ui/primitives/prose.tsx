import { Streamdown, type AllowedTags, type Components } from "streamdown";
import { markdownComponents } from "./markdown-component-map";

export function Prose({
  children,
  allowedTags,
  components,
}: {
  children: string;
  allowedTags?: AllowedTags;
  components?: Components;
}) {
  return (
    <article className="flex flex-col gap-2">
      <Streamdown
        allowedTags={allowedTags}
        components={{ ...markdownComponents, ...components }}
      >
        {children}
      </Streamdown>
    </article>
  );
}
