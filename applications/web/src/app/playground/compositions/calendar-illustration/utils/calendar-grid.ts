const indexToDayNumber = (index: number, daysInMonth: number): number => (index % daysInMonth) + 1;

const createGridIndices = (columns: number, rows: number): number[] => {
  const totalCells = columns * rows;
  const indices: number[] = [];
  for (let index = 0; index < totalCells; index++) {
    indices.push(index);
  }
  return indices;
};

export { indexToDayNumber, createGridIndices };
