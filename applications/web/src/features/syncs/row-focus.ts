const FOCUSABLE = "button:not([disabled]), input, [href]";

const firstFocusable = (element: Element): HTMLElement | null => {
  if (element instanceof HTMLElement && element.matches(FOCUSABLE)) return element;
  return element.querySelector<HTMLElement>(FOCUSABLE);
};

const siblingFocusable = (from: Element | null, step: (element: Element) => Element | null): HTMLElement | null => {
  for (let sibling = from; sibling; sibling = step(sibling)) {
    const target = firstFocusable(sibling);
    if (target) return target;
  }
  return null;
};

// The row after the one being removed, or the one before when it was the last.
export const focusNeighbour = (from: HTMLElement, rowSelector = "li"): HTMLElement | null => {
  const row = from.closest(rowSelector);
  if (!row) return null;
  return siblingFocusable(row.nextElementSibling, (element) => element.nextElementSibling)
    ?? siblingFocusable(row.previousElementSibling, (element) => element.previousElementSibling);
};

// Removing a row unmounts the button that had focus, so focus moves on rather than falling to the page.
export const focusLater = (target: HTMLElement | null): void => {
  if (!target) return;
  requestAnimationFrame(() => {
    if (target.isConnected) target.focus();
  });
};
