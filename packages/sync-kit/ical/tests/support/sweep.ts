const adversarialZoneList = [
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Santiago",
  "America/Sao_Paulo",
  "Asia/Tehran",
  "Asia/Kathmandu",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
  "Pacific/Apia",
  "Africa/Casablanca",
  "Antarctica/Troll",
  "Asia/Jerusalem",
  "America/Godthab",
  "Asia/Gaza",
] as const;

const seededSample = (values: readonly string[], count: number, seed: number): readonly string[] => {
  const picked: string[] = [];
  let state = seed;
  for (let index = 0; index < count; index++) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const candidate = values[state % values.length];
    if (candidate) {
      picked.push(candidate);
    }
  }
  return picked;
};

const hourlyWallTimes = (year: number, month: number, day: number): readonly string[] => {
  const stamp = `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  return Array.from(
    { length: 24 },
    (_unused, hour) => `${stamp}T${String(hour).padStart(2, "0")}0000`,
  );
};

export { adversarialZoneList, hourlyWallTimes, seededSample };
