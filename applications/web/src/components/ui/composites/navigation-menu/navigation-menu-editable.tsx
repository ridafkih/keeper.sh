import { use, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import { cn } from "@/utils/cn";
import { ItemDisabledContext, MenuVariantContext } from "./navigation-menu.contexts";
import {
  DISABLED_LABEL_TONE,
  LABEL_TONE,
  navigationMenuItemIconStyle,
  navigationMenuItemStyle,
} from "./navigation-menu.styles";
import { NavigationMenuItemLabel } from "./navigation-menu-items";
import { Text } from "@/components/ui/primitives/text";

type NavigationMenuEditableItemProps = {
  onCommit: (value: string) => Promise<void> | void;
  label?: string;
  children?: ReactNode;
  defaultEditing?: boolean;
  disabled?: boolean;
  className?: string;
} & ({ value: string } | { getValue: () => string });

export function NavigationMenuEditableItem(props: NavigationMenuEditableItemProps) {
  const {
    onCommit,
    label,
    children,
    defaultEditing,
    disabled,
    className,
  } = props;

  const resolveValue = () => "getValue" in props ? props.getValue() : props.value;

  const [editing, setEditing] = useState(defaultEditing ?? false);

  const startEditing = () => setEditing(true);
  const stopEditing = () => setEditing(false);

  if (editing) {
    return (
      <EditableItemInput
        value={resolveValue()}
        label={label}
        className={className}
        onCommit={async (trimmed) => {
          await onCommit(trimmed);
          stopEditing();
        }}
        onCancel={stopEditing}
      />
    );
  }

  return (
    <EditableItemDisplay
      label={label}
      disabled={disabled}
      className={className}
      onStartEditing={startEditing}
    >
      {children ?? <EditableItemDefaultValue value={resolveValue()} label={label} />}
    </EditableItemDisplay>
  );
}

type NavigationMenuEditableTemplateItemProps = {
  onCommit: (value: string) => Promise<void> | void;
  label?: string;
  valueContent?: ReactNode;
  children?: ReactNode;
  renderInput: (value: string) => ReactNode;
  defaultEditing?: boolean;
  disabled?: boolean;
  className?: string;
} & ({ value: string } | { getValue: () => string });

export function NavigationMenuEditableTemplateItem(props: NavigationMenuEditableTemplateItemProps) {
  const {
    onCommit,
    label,
    valueContent,
    children,
    renderInput,
    defaultEditing,
    disabled,
    className,
  } = props;

  const resolveValue = () => "getValue" in props ? props.getValue() : props.value;

  const [editing, setEditing] = useState(defaultEditing ?? false);

  const startEditing = () => setEditing(true);
  const stopEditing = () => setEditing(false);

  if (editing) {
    return (
      <EditableTemplateItemInput
        value={resolveValue()}
        label={label}
        renderInput={renderInput}
        className={className}
        onCommit={async (trimmed) => {
          await onCommit(trimmed);
          stopEditing();
        }}
        onCancel={stopEditing}
      />
    );
  }

  return (
    <EditableItemDisplay
      label={label}
      disabled={disabled}
      className={className}
      onStartEditing={startEditing}
    >
      {children ?? <EditableItemDefaultValue value={valueContent ?? resolveValue()} label={label} />}
    </EditableItemDisplay>
  );
}

function useEditableCommit(
  value: string,
  onCommit: (value: string) => Promise<void> | void,
  onCancel: () => void,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

  const commit = async () => {
    if (committingRef.current) return;

    const trimmed = inputRef.current?.value.trim();
    if (!trimmed || trimmed === value) {
      onCancel();
      return;
    }

    committingRef.current = true;
    try {
      await onCommit(trimmed);
    } finally {
      committingRef.current = false;
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    }

    if (event.key === "Escape") {
      onCancel();
    }
  };

  const inputProps = {
    ref: inputRef,
    type: "text" as const,
    defaultValue: value,
    autoComplete: "off",
    onBlur: () => {
      void commit();
    },
    onKeyDown: handleKeyDown,
    autoFocus: true,
  };

  return { inputProps };
}

function EditableItemInput({
  value,
  label,
  className,
  onCommit,
  onCancel,
}: {
  value: string;
  label?: string;
  className?: string;
  onCommit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const variant = use(MenuVariantContext);
  const { inputProps } = useEditableCommit(value, onCommit, onCancel);
  const inputClass = cn(
    "min-w-0 text-base tracking-tight bg-transparent cursor-text outline-none",
    label ? "flex-1 text-right" : "flex-1",
  );

  return (
    <li className="relative z-10 rounded-[0.875rem] has-focus:ring-2 has-focus:ring-ring">
      <div className={navigationMenuItemStyle({ variant, interactive: false, className })}>
        {label && <NavigationMenuItemLabel className="shrink-0">{label}</NavigationMenuItemLabel>}
        <input {...inputProps} className={cn(inputClass, "text-foreground-muted")} />
      </div>
    </li>
  );
}

function EditableTemplateItemInput({
  value,
  label,
  className,
  renderInput,
  onCommit,
  onCancel,
}: {
  value: string;
  label?: string;
  className?: string;
  renderInput: (value: string) => ReactNode;
  onCommit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const variant = use(MenuVariantContext);
  const { inputProps } = useEditableCommit(value, onCommit, onCancel);
  const inputClass = cn(
    "min-w-0 text-base tracking-tight bg-transparent cursor-text outline-none",
    label ? "flex-1 text-right" : "flex-1",
  );

  return (
    <li className="relative z-10 rounded-[0.875rem] has-focus:ring-2 has-focus:ring-ring">
      <div className={navigationMenuItemStyle({ variant, interactive: false, className })}>
        {label && <NavigationMenuItemLabel className="shrink-0">{label}</NavigationMenuItemLabel>}
        <div className={cn(inputClass, "grid items-center")}>
          <input
            {...inputProps}
            className={cn(
              "col-start-1 row-start-1 w-full text-base tracking-tight bg-transparent text-transparent caret-foreground-muted cursor-text outline-none",
              label && "text-right",
            )}
          />
          <TemplateInputOverlay
            inputRef={inputProps.ref}
            defaultValue={value}
            renderInput={renderInput}
            label={label}
          />
        </div>
      </div>
    </li>
  );
}

function TemplateInputOverlay({
  inputRef,
  defaultValue,
  renderInput,
  label,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  defaultValue: string;
  renderInput: (value: string) => ReactNode;
  label?: string;
}) {
  const [liveValue, setLiveValue] = useState(defaultValue);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleInput = () => setLiveValue(input.value);
    const handleScroll = () => {
      if (overlayRef.current) overlayRef.current.scrollLeft = input.scrollLeft;
    };

    input.addEventListener("input", handleInput);
    input.addEventListener("scroll", handleScroll);
    return () => {
      input.removeEventListener("input", handleInput);
      input.removeEventListener("scroll", handleScroll);
    };
  }, [inputRef]);

  return (
    <div
      ref={overlayRef}
      className={cn(
        "col-start-1 row-start-1 pointer-events-none text-base tracking-tight whitespace-pre overflow-hidden",
        label && "text-right",
      )}
    >
      {renderInput(liveValue)}
    </div>
  );
}

function EditableItemDefaultValue({ value, label }: { value: ReactNode; label?: string }) {
  const variant = use(MenuVariantContext);
  const disabled = use(ItemDisabledContext);

  return (
    <Text
      size="sm"
      tone={(disabled ? DISABLED_LABEL_TONE : LABEL_TONE)[variant ?? "default"]}
      className={cn("min-w-0 truncate", label && "flex-1 text-right")}
    >
      {value}
    </Text>
  );
}

function EditableItemDisplay({
  label,
  children,
  disabled: disabledProp,
  className,
  onStartEditing,
}: {
  label?: string;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  onStartEditing: () => void;
}) {
  const variant = use(MenuVariantContext);
  const disabledFromContext = use(ItemDisabledContext);
  const disabled = disabledProp || disabledFromContext;

  return (
    <li>
      <ItemDisabledContext value={disabled}>
        <button
          type="button"
          onClick={() => !disabled && onStartEditing()}
          disabled={disabled}
          className={navigationMenuItemStyle({ variant, interactive: !disabled, className })}
        >
          {label && <NavigationMenuItemLabel className="shrink-0">{label}</NavigationMenuItemLabel>}
          {children}
          <Pencil
            size={14}
            className={navigationMenuItemIconStyle({
              variant,
              disabled,
              className: label ? "shrink-0" : "ml-auto",
            })}
          />
        </button>
      </ItemDisabledContext>
    </li>
  );
}
