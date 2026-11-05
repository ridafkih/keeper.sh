import type { ConformanceCaseId } from "../case-id";

type Defect = ConformanceCaseId | null;

const defectIs = (defect: Defect, id: ConformanceCaseId): boolean => defect === id;

const markerOf = (id: ConformanceCaseId): string => `${id}:`;

const isMarked = (value: string, id: ConformanceCaseId): boolean =>
  value.startsWith(markerOf(id));

export { defectIs, isMarked, markerOf };
export type { Defect };
