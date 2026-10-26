import { use, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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
import { shouldSkipEditableCommit } from "./navigation-menu-editable-logic";

type NavigationMenuEditableItemProps = {
  onCommit: (value: string) => Promise<void> | void;
  /** Called when editing ends without a commit, so a freshly added row can be discarded. */
  onCancel?: () => void;
  label?: string;
  children?: ReactNode;
  /** Sits beside the row, outside its click target, for a control such as a remove button. */
  trailing?: ReactNode;
  defaultEditing?: boolean;
  disabled?: boolean;
  allowEmpty?: boolean;
  className?: string;
} & ({ value: string } | { getValue: () => string });

export function NavigationMenuEditableItem(props: NavigationMenuEditableItemProps) {
  const {
    onCommit,
    onCancel,
    label,
    children,
    trailing,
    defaultEditing,
    disabled,
    allowEmpty,
    className,
  } = props;

  const resolveValue = () => "getValue" in props ? props.getValue() : props.value;

  const [editing, setEditing] = useState(defaultEditing ?? false);

  const startEditing = () => setEditing(true);
  const stopEditing = () => setEditing(false);
  const cancelEditing = () => {
    stopEditing();
    onCancel?.();
  };

  return (
    <EditableRow editing={editing} trailing={trailing}>
      {editing ? (
        <EditableItemInput
          value={resolveValue()}
          label={label}
          allowEmpty={allowEmpty}
          className={className}
          onCommit={async (trimmed) => {
            await onCommit(trimmed);
            stopEditing();
          }}
          onCancel={cancelEditing}
        />
      ) : (
        <EditableItemDisplay
          label={label}
          disabled={disabled}
          className={className}
          onStartEditing={startEditing}
        >
          {children ?? <EditableItemDefaultValue value={resolveValue()} label={label} />}
        </EditableItemDisplay>
      )}
    </EditableRow>
  );
}

type NavigationMenuEditableTemplateItemProps = {
  onCommit: (value: string) => Promise<void> | void;
  onCancel?: () => void;
  label?: string;
  valueContent?: ReactNode;
  children?: ReactNode;
  trailing?: ReactNode;
  renderInput: (value: string) => ReactNode;
  defaultEditing?: boolean;
  disabled?: boolean;
  className?: string;
} & ({ value: string } | { getValue: () => string });

export function NavigationMenuEditableTemplateItem(props: NavigationMenuEditableTemplateItemProps) {
  const {
    onCommit,
    onCancel,
    label,
    valueContent,
    children,
    trailing,
    renderInput,
    defaultEditing,
    disabled,
    className,
  } = props;

  const resolveValue = () => "getValue" in props ? props.getValue() : props.value;

  const [editing, setEditing] = useState(defaultEditing ?? false);

  const startEditing = () => setEditing(true);
  const stopEditing = () => setEditing(false);
  const cancelEditing = () => {
    stopEditing();
    onCancel?.();
  };

  return (
    <EditableRow editing={editing} trailing={trailing}>
      {editing ? (
        <EditableTemplateItemInput
          value={resolveValue()}
          label={label}
          renderInput={renderInput}
          className={className}
          onCommit={async (trimmed) => {
            await onCommit(trimmed);
            stopEditing();
          }}
          onCancel={cancelEditing}
        />
      ) : (
        <EditableItemDisplay
          label={label}
          disabled={disabled}
          className={className}
          onStartEditing={startEditing}
        >
          {children ?? <EditableItemDefaultValue value={valueContent ?? resolveValue()} label={label} />}
        </EditableItemDisplay>
      )}
    </EditableRow>
  );
}

function useEditableCommit(
  value: string,
  onCommit: (value: string) => Promise<void> | void,
  onCancel: () => void,
  allowEmpty = false,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

  const commit = async () => {
    if (committingRef.current) return;

    if (!inputRef.current) {
      onCancel();
      return;
    }

    const trimmed = inputRef.current.value.trim();
    if (shouldSkipEditableCommit(trimmed, value, allowEmpty)) {
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

const keepInputFocused = (event: ReactMouseEvent) => event.preventDefault();

// The row and its trailing slot stay mounted across the editing toggle, so a focused remove button keeps its focus.
// While editing, pressing the trailing control keeps focus in the input, so its click lands instead of a blur commit.
function EditableRow({ editing, trailing, children }: { editing: boolean; trailing?: ReactNode; children: ReactNode }) {
  return (
    <li className={cn(editing && "relative z-10 rounded-[0.875rem] has-focus:ring-2 has-focus:ring-ring", trailing && "flex items-center")}>
      {children}
      {trailing && (
        <div className="contents" onMouseDown={editing ? keepInputFocused : undefined}>
          {trailing}
        </div>
      )}
    </li>
  );
}

function EditableItemInput({
  value,
  label,
  allowEmpty,
  className,
  onCommit,
  onCancel,
}: {
  value: string;
  label?: string;
  allowEmpty?: boolean;
  className?: string;
  onCommit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const variant = use(MenuVariantContext);
  const { inputProps } = useEditableCommit(value, onCommit, onCancel, allowEmpty);
  const inputClass = cn(
    "min-w-0 text-sm tracking-tight bg-transparent cursor-text outline-none",
    label ? "flex-1 text-right" : "flex-1",
  );

  return (
    <div className={navigationMenuItemStyle({ variant, interactive: false, className: cn("min-w-0 flex-1", className) })}>
      {label && <NavigationMenuItemLabel className="shrink-0">{label}</NavigationMenuItemLabel>}
      <input {...inputProps} className={cn(inputClass, "text-foreground-muted")} />
    </div>
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
    "min-w-0 text-sm tracking-tight bg-transparent cursor-text outline-none",
    label ? "flex-1 text-right" : "flex-1",
  );

  return (
    <div className={navigationMenuItemStyle({ variant, interactive: false, className: cn("min-w-0 flex-1", className) })}>
      {label && <NavigationMenuItemLabel className="shrink-0">{label}</NavigationMenuItemLabel>}
      <div className={cn(inputClass, "grid items-center")}>
        <input
          {...inputProps}
          className={cn(
            "col-start-1 row-start-1 w-full text-sm tracking-tight bg-transparent text-transparent caret-foreground-muted cursor-text outline-none",
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
        "col-start-1 row-start-1 pointer-events-none text-sm tracking-tight whitespace-pre overflow-hidden",
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
    <ItemDisabledContext value={disabled}>
      <button
        type="button"
        onClick={() => !disabled && onStartEditing()}
        disabled={disabled}
        className={navigationMenuItemStyle({ variant, interactive: !disabled, className: cn("min-w-0 flex-1", className) })}
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
  );
}
