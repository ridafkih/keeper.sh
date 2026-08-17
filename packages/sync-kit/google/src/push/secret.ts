const equalsInConstantTime = (left: string, right: string): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  /*
   * Every position is compared with no early exit, so the running time depends on the length
   * alone and never on how far the two strings agree.
   */
  const scan = { differences: 0 };
  for (const position of Array.from({ length: left.length }, (unused, index) => index)) {
    scan.differences += Number(left.codePointAt(position) !== right.codePointAt(position));
  }
  return scan.differences === 0;
};

const verifyChannelToken = (
  presented: string,
  storedHash: string,
  hash: (input: string) => string,
): boolean => {
  if (presented.length === 0 || storedHash.length === 0) {
    return false;
  }
  return equalsInConstantTime(hash(presented), storedHash);
};

export { verifyChannelToken };
