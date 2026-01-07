export const getGridSize = (columns: number, rows: number): number => columns * rows;

export const getGridDimensions = (totalCells: number, columns: number) => ({
  columns,
  rows: Math.ceil(totalCells / columns),
});

export const indexToGridPosition = (index: number, columns: number) => ({
  row: Math.floor(index / columns),
  column: index % columns,
});

export const gridPositionToIndex = (row: number, column: number, columns: number): number =>
  row * columns + column;

export const indexToDayNumber = (index: number, daysInMonth: number): number =>
  (index % daysInMonth) + 1;

export const isValidDayIndex = (index: number, daysInMonth: number): boolean =>
  index < daysInMonth;

export const getDayNumbersForMonth = (daysInMonth: number): number[] => {
  const days: number[] = [];
  for (let index = 0; index < daysInMonth; index++) {
    days.push(index + 1);
  }
  return days;
};

export const createGridIndices = (columns: number, rows: number): number[] => {
  const totalCells = columns * rows;
  const indices: number[] = [];
  for (let index = 0; index < totalCells; index++) {
    indices.push(index);
  }
  return indices;
};

export const createEmptyGrid = <T>(columns: number, rows: number, fill: T): T[] => {
  const totalCells = columns * rows;
  const grid: T[] = [];
  for (let index = 0; index < totalCells; index++) {
    grid.push(fill);
  }
  return grid;
};
