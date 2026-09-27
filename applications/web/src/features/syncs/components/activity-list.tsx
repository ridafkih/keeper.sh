import Pencil from "lucide-react/dist/esm/icons/pencil";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import type { SyncActivityEntry } from "@keeper.sh/data-schemas";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuEmptyItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { formatActivityTime } from "../relative-time";
import { describeChange, describeRun, type CalendarsById } from "../syncs";

interface ActivityListProps {
  entries: SyncActivityEntry[];
  calendarsById: CalendarsById;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

const entryIcon = (entry: SyncActivityEntry) => {
  if (entry.kind === "change") return <Pencil size={15} />;
  if (entry.run.failed > 0) return <TriangleAlert size={15} className="text-attention" />;
  return <RefreshCw size={15} />;
};

export function ActivityList({ entries, calendarsById, hasMore, loadingMore, onLoadMore }: ActivityListProps) {
  return (
    <NavigationMenu>
      {entries.length === 0 && <NavigationMenuEmptyItem>Changes and sync runs show up here</NavigationMenuEmptyItem>}
      {entries.map((entry) => (
        <NavigationMenuItem key={entry.id} className="items-start">
          <NavigationMenuItemIcon>{entryIcon(entry)}</NavigationMenuItemIcon>
          <Text size="sm" tone="default" className="min-w-0 flex-1">
            {entry.kind === "change" ? describeChange(entry.change, calendarsById) : describeRun(entry.run, calendarsById)}
          </Text>
          <Text size="sm" tone="muted" className="shrink-0 tabular-nums">{formatActivityTime(entry.createdAt)}</Text>
        </NavigationMenuItem>
      ))}
      {hasMore && (
        <NavigationMenuButtonItem disabled={loadingMore} onClick={onLoadMore}>
          <NavigationMenuItemLabel>{loadingMore ? "Loading…" : "Show Older"}</NavigationMenuItemLabel>
        </NavigationMenuButtonItem>
      )}
    </NavigationMenu>
  );
}
