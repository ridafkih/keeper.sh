import { Heading1, Heading3 } from "../../../components/heading";
import { Input } from "../../../components/input";
import { Select } from "../../../components/select";
import { Checkbox } from "../../../components/checkbox";
import { Radio } from "../../../components/radio";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "../../../components/dropdown-menu";
import { User, Settings, LogOut, Pencil, Copy, Trash2 } from "lucide-react";
import { ModalDemo } from "./modal-demo";
import { ConnectionPreambleDemo } from "./connection-preamble-demo";

const DemoPage = () => (
  <div className="flex flex-col gap-8 pt-16 pb-8">
    <Heading1>Demo</Heading1>

    <div className="flex flex-col gap-2">
      <Heading3>Input</Heading3>
      <Input placeholder="Default size" />
      <Input inputSize="small" placeholder="Small size" />
      <Input disabled placeholder="Disabled" />
    </div>

    <div className="flex flex-col gap-2">
      <Heading3>Select</Heading3>
      <Select>
        <option>Default size</option>
        <option>Option 2</option>
        <option>Option 3</option>
      </Select>
      <Select selectSize="small">
        <option>Small size</option>
        <option>Option 2</option>
        <option>Option 3</option>
      </Select>
      <Select disabled>
        <option>Disabled</option>
      </Select>
    </div>

    <div className="flex flex-col gap-2 items-start">
      <Heading3>Dropdown Menu</Heading3>
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Account</DropdownMenuLabel>
          <DropdownMenuItem><User size={16} />Profile</DropdownMenuItem>
          <DropdownMenuItem><Settings size={16} />Settings</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem><LogOut size={16} />Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger dropdownSize="small">Small Trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem><Pencil size={14} />Edit</DropdownMenuItem>
          <DropdownMenuItem><Copy size={14} />Duplicate</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem><Trash2 size={14} />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div className="flex flex-col gap-2">
      <Heading3>Checkbox</Heading3>
      <Checkbox id="check-1" label="Default size" />
      <Checkbox id="check-2" checkboxSize="small" label="Small size" />
      <Checkbox id="check-3" label="Checked" defaultChecked />
      <Checkbox id="check-4" label="Disabled" disabled />
    </div>

    <div className="flex flex-col gap-2">
      <Heading3>Radio</Heading3>
      <Radio id="radio-1" name="demo" label="Default size" />
      <Radio id="radio-2" name="demo" radioSize="small" label="Small size" />
      <Radio id="radio-3" name="demo-2" label="Selected" defaultChecked />
      <Radio id="radio-4" name="demo-3" label="Disabled" disabled />
    </div>

    <div className="flex flex-col gap-2 items-start">
      <Heading3>Modal</Heading3>
      <ModalDemo />
    </div>

    <div className="flex flex-col gap-2 items-start">
      <Heading3>Connection Preamble Modal</Heading3>
      <ConnectionPreambleDemo />
    </div>
  </div>
);

export default DemoPage;
