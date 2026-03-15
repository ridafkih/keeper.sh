import { type PropsWithChildren, type ReactNode, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Text } from "./text";

const GAP = 4;
const ABOVE_CLEARANCE = 32;

type TooltipProps = PropsWithChildren<{
  content: ReactNode;
}>;

export function Tooltip({ children, content }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, above: true });

  const show = useCallback(() => {
    const child = wrapperRef.current?.firstElementChild;
    if (!child) return;
    const rect = child.getBoundingClientRect();
    const above = rect.top >= ABOVE_CLEARANCE;

    setPosition({
      x: rect.left + rect.width / 2,
      y: above ? rect.top - GAP : rect.bottom + GAP,
      above,
    });
    setVisible(true);
  }, []);

  const hide = useCallback(() => setVisible(false), []);

  return (
    <div
      ref={wrapperRef}
      className="contents"
      onPointerEnter={show}
      onPointerLeave={hide}
    >
      {children}
      {visible && createPortal(
        <div
          className="fixed z-50 pointer-events-none pointer-coarse:hidden"
          style={{
            left: position.x,
            top: position.y,
            transform: `translateX(-50%)${position.above ? " translateY(-100%)" : ""}`,
          }}
        >
          <div className="rounded-md bg-background-inverse px-2.5 py-1">
            <Text as="span" size="xs" tone="inverse">{content}</Text>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
