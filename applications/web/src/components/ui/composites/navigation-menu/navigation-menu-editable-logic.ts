export const shouldSkipEditableCommit = (
  next: string,
  current: string,
  allowEmpty: boolean,
): boolean => (!next && !allowEmpty) || next === current;
