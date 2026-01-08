import { Scaffold } from "../../../components/scaffold";
import { Heading1, Heading3 } from "../../../components/heading";
import { Input } from "../../../components/input";
import { Dropdown } from "../../../components/dropdown";
import { Checkbox } from "../../../components/checkbox";
import { Radio } from "../../../components/radio";

const DemoPage = () => (
  <Scaffold className="py-8">
    <Heading1>Demo</Heading1>

    <div className="flex flex-col gap-2">
      <Heading3>Input</Heading3>
      <Input placeholder="Default size" />
      <Input inputSize="small" placeholder="Small size" />
      <Input disabled placeholder="Disabled" />
    </div>

    <div className="flex flex-col gap-2">
      <Heading3>Dropdown</Heading3>
      <Dropdown>
        <option>Default size</option>
        <option>Option 2</option>
        <option>Option 3</option>
      </Dropdown>
      <Dropdown dropdownSize="small">
        <option>Small size</option>
        <option>Option 2</option>
        <option>Option 3</option>
      </Dropdown>
      <Dropdown disabled>
        <option>Disabled</option>
      </Dropdown>
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
  </Scaffold>
);

export default DemoPage;
