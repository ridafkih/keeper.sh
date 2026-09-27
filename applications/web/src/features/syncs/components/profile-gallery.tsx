import Briefcase from "lucide-react/dist/esm/icons/briefcase";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import Users from "lucide-react/dist/esm/icons/users";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { SYNC_TEMPLATE_ORDER, SYNC_TEMPLATES, type SyncTemplateKey } from "../templates";

const TEMPLATE_ICONS: Record<SyncTemplateKey, typeof Users> = {
  block_my_time: ShieldCheck,
  hide_the_details: EyeOff,
  share_with_family: Users,
  work_copy: Briefcase,
};

interface ProfileGalleryProps {
  disabled?: boolean;
  onPick: (template: SyncTemplateKey | null) => void;
}

export function ProfileGallery({ disabled, onPick }: ProfileGalleryProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 gap-1.5 xs:grid-cols-2">
        {SYNC_TEMPLATE_ORDER.map((key) => {
          const template = SYNC_TEMPLATES[key];
          const Icon = TEMPLATE_ICONS[key];
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onPick(key)}
              className="flex flex-col gap-1.5 rounded-2xl border border-interactive-border bg-background p-3.5 text-left shadow-xs hover:bg-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-sm font-medium tracking-tight text-foreground">
                <Icon size={16} />
                {template.name}
              </span>
              <Text size="sm" tone="muted">{template.description}</Text>
              <Text size="xs" tone="muted" className="mt-auto border-t border-dashed border-interactive-border pt-1.5">{template.spec}</Text>
            </button>
          );
        })}
      </div>
      <NavigationMenu>
        <NavigationMenuButtonItem disabled={disabled} onClick={() => onPick(null)}>
          <NavigationMenuItemIcon>
            <Pencil size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Start From Scratch</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuButtonItem>
      </NavigationMenu>
    </div>
  );
}
