const at = <Item,>(items: readonly Item[], index: number): Item => {
  if (index >= items.length) {
    throw new Error(`expected an item at index ${index} of ${items.length}`);
  }
  const found = items.slice(index, index + 1);
  for (const item of found) {
    return item;
  }
  throw new Error(`expected an item at index ${index} of ${items.length}`);
};

const firstOf = <Item,>(items: readonly Item[]): Item => at(items, 0);

export { at, firstOf };
