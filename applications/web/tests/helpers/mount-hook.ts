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

export interface MountedHook<T> {
  latest: () => T;
  unmount: () => void;
}

/** Renders the hook in a linkedom document swapped into the globals; `unmount` puts them back. */
export function mountHook<T>(useHook: () => T): MountedHook<T> {
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

  const container = window.document.getElementById("root") as unknown as Element;
  const root = createRoot(container);
  const renders: T[] = [];

  const Probe = () => {
    renders.push(useHook());
    return null;
  };

  React.act(() => {
    root.render(React.createElement(Probe));
  });

  return {
    latest: () => {
      if (renders.length === 0) {
        throw new Error("Hook never rendered");
      }
      return renders[renders.length - 1];
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
