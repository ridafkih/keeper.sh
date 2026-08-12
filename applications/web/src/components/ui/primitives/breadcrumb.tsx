import { Link } from "@tanstack/react-router";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import type { BreadcrumbTrailItem } from "@/lib/seo";
import { Text } from "./text";

const crumbLink =
  "group relative inline-flex items-center rounded-sm after:absolute after:inset-0 after:-mx-2 after:-my-3 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type BreadcrumbProps = {
  items: BreadcrumbTrailItem[];
  className?: string;
};

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  const currentItem = items[items.length - 1];
  if (!currentItem) {
    throw new Error("Breadcrumb requires at least one item");
  }

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 list-none">
        {items.slice(0, -1).map((item) => (
          <li key={item.path} className="inline-flex items-center gap-x-2">
            <Link to={item.path} activeOptions={{ exact: true }} className={crumbLink}>
              <Text as="span" size="sm" tone="muted" className="group-hover:text-foreground">
                {item.name}
              </Text>
            </Link>
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-foreground-muted" />
          </li>
        ))}
        <li aria-current="page" className="min-w-0" title={currentItem.name}>
          <Text as="span" size="sm" tone="default" className="block max-w-56 truncate sm:max-w-none">
            {currentItem.name}
          </Text>
        </li>
      </ol>
    </nav>
  );
}
