export const shouldShowEvents = (index: number, maxIndex: number): boolean => index <= maxIndex;

export const shouldShowOverflow = (eventCount: number, maxVisible: number): boolean =>
  eventCount > maxVisible;

export const isFirstColumn = (index: number, columns: number): boolean => index % columns === 0;

export const isLastColumn = (index: number, columns: number): boolean =>
  index % columns === columns - 1;

export const isFirstRow = (index: number, columns: number): boolean => index < columns;

export const isLastRow = (index: number, columns: number, totalCells: number): boolean =>
  index >= totalCells - columns;
