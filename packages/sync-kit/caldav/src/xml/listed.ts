function listed<Entry>(carried?: Entry | readonly Entry[] | null): readonly Entry[];
function listed(carried: unknown = null): readonly unknown[] {
  if (carried === null) {
    return [];
  }
  if (Array.isArray(carried)) {
    return carried;
  }
  return [carried];
}

export { listed };
