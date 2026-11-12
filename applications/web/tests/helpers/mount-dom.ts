import * as React from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";

const INJECTED_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Text",
  "Event",
  "MutationObserver",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;

export interface MountedDom {
  container: HTMLElement;
  document: Document;
  rerender: (element: React.ReactElement) => void;
  /** Dispatches a bubbling, cancelable event, with extra fields such as `key` set on it, and returns it. */
  fire: (target: EventTarget, type: string, fields?: Record<string, unknown>) => Event;
  /** Lets pending promises and the renders they cause settle. */
  flush: () => Promise<void>;
  unmount: () => void;
}

/** Renders into a linkedom document swapped into the globals; `unmount` puts them back. */
export function mountDom(element: React.ReactElement): MountedDom {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const previous = Object.fromEntries(
    INJECTED_GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
  );
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Text: window.Text,
    Event: window.Event,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  // React was loaded before this DOM existed, so it falls back to its old-IE input polyfill, which needs these.
  Object.assign(window.HTMLElement.prototype, { attachEvent: () => null, detachEvent: () => null });

  const container = window.document.getElementById("root") as unknown as HTMLElement;
  const root = createRoot(container);
  React.act(() => {
    root.render(element);
  });

  return {
    container,
    document: window.document as unknown as Document,
    fire: (target, type, fields = {}) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true }) as unknown as Event;
      for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
      React.act(() => {
        target.dispatchEvent(event);
      });
      return event;
    },
    flush: async () => {
      await React.act(async () => {
        await Promise.resolve();
      });
    },
    rerender: (next) => {
      React.act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      React.act(() => {
        root.unmount();
      });
      for (const key of INJECTED_GLOBALS) {
        if (previous[key] === undefined) {
          delete (globalThis as Record<string, unknown>)[key];
          continue;
        }
        (globalThis as Record<string, unknown>)[key] = previous[key];
      }
    },
  };
}
