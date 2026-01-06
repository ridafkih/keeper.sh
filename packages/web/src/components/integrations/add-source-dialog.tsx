"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { Menu } from "@base-ui/react/menu";
import { PROVIDER_DEFINITIONS } from "@keeper.sh/provider-registry";
import type { ProviderDefinition } from "@keeper.sh/provider-registry";
import { MenuItem } from "@/components/menu-item";
import { MenuPopup } from "@/components/menu-popup";
import { Link as LinkIcon, Server } from "lucide-react";

type SourceType = "ics" | "google" | "outlook" | "caldav" | "fastmail" | "icloud";

interface SourceMenuItemIconProps {
  provider: ProviderDefinition;
}

const SourceMenuItemIcon = ({ provider }: SourceMenuItemIconProps): ReactNode => {
  if (provider.icon) {
    return <Image src={provider.icon} alt={provider.name} width={14} height={14} />;
  }
  return <Server size={14} className="text-foreground-subtle" />;
};

interface SourcesMenuProps {
  onSelect: (type: SourceType) => void;
}

const SourcesMenu = ({ onSelect }: SourcesMenuProps): ReactNode => (
  <>
    <MenuItem onClick={() => onSelect("ics")} className="py-1.5">
      <LinkIcon size={14} className="text-foreground-subtle" />
      <span>iCal Link</span>
    </MenuItem>
    {PROVIDER_DEFINITIONS.map((provider) => (
      <MenuItem
        key={provider.id}
        onClick={() => onSelect(provider.id as SourceType)}
        className="py-1.5"
      >
        <SourceMenuItemIcon provider={provider} />
        <span>{provider.name}</span>
      </MenuItem>
    ))}
  </>
);

interface NewSourceMenuProps {
  onSelect: (type: SourceType) => void;
  trigger: ReactNode;
  align?: "start" | "center" | "end";
}

const NewSourceMenu = ({ onSelect, trigger, align = "start" }: NewSourceMenuProps): ReactNode => (
  <Menu.Root>
    {trigger}
    <Menu.Portal>
      <Menu.Positioner sideOffset={4} align={align}>
        <MenuPopup>
          <SourcesMenu onSelect={onSelect} />
        </MenuPopup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
);

export { NewSourceMenu, SourcesMenu };
export type { SourceType };
