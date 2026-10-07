const conformanceCaseIds = [
  "CONF-O1",
  "CONF-O2",
  "CONF-O3",
  "CONF-O4",
  "CONF-O5",
  "CONF-O6",
  "CONF-O7",
  "CONF-O8",
  "CONF-O9",
  "CONF-O10",
  "CONF-O11",
  "CONF-O12",
  "CONF-O13",
  "CONF-O14",
  "CONF-O15",
  "CONF-O16",
  "CONF-O17",
  "CONF-O18",
  "CONF-O19",
  "CONF-O20",
  "CONF-O21",
  "CONF-O22",
  "CONF-O23",
  "CONF-O24",
  "CONF-O25",
  "CONF-O26",
  "CONF-O27",
  "CONF-O28",
  "CONF-O29",
  "CONF-O30",
  "CONF-O31",
  "CONF-O32",
  "CONF-O33",
  "CONF-O34",
  "CONF-O35",
  "CONF-O36",
  "CONF-O37",
  "CONF-O38",
  "CONF-O39",
  "CONF-O40",
  "CONF-O41",
  "CONF-O42",
  "CONF-O43",
  "CONF-O44",
  "CONF-O45",
  "CONF-O46",
  "CONF-L1",
  "CONF-L2",
  "CONF-L3",
  "CONF-L4",
  "CONF-L5",
  "CONF-L6",
  "CONF-L7",
  "CONF-L8",
  "CONF-L9",
  "CONF-L10",
  "CONF-L11",
  "CONF-L12",
  "CONF-L13",
] as const;

type ConformanceCaseId = (typeof conformanceCaseIds)[number];

type LedgerEntryId = `CONF-I${number}`;

interface LedgerCitation {
  readonly entry: LedgerEntryId;
  readonly cases: readonly ConformanceCaseId[];
}

const ledgerCitations: readonly LedgerCitation[] = [
  { entry: "CONF-I1", cases: ["CONF-O1"] },
  { entry: "CONF-I2", cases: ["CONF-O2"] },
  { entry: "CONF-I3", cases: ["CONF-O3"] },
  { entry: "CONF-I4", cases: ["CONF-O4"] },
  { entry: "CONF-I5", cases: ["CONF-O5"] },
  { entry: "CONF-I6", cases: ["CONF-O6"] },
  { entry: "CONF-I7", cases: ["CONF-O7"] },
  { entry: "CONF-I8", cases: ["CONF-O8"] },
  { entry: "CONF-I9", cases: ["CONF-O9"] },
  { entry: "CONF-I10", cases: ["CONF-O10"] },
  { entry: "CONF-I11", cases: ["CONF-O11"] },
  { entry: "CONF-I12", cases: ["CONF-O12"] },
  { entry: "CONF-I13", cases: ["CONF-O13"] },
  { entry: "CONF-I14", cases: ["CONF-O14", "CONF-O15"] },
  { entry: "CONF-I15", cases: ["CONF-O16"] },
  { entry: "CONF-I16", cases: ["CONF-O17"] },
  { entry: "CONF-I17", cases: ["CONF-O18", "CONF-O19"] },
  { entry: "CONF-I18", cases: ["CONF-O20"] },
  { entry: "CONF-I19", cases: ["CONF-O21"] },
  { entry: "CONF-I20", cases: ["CONF-O22"] },
  { entry: "CONF-I21", cases: ["CONF-L1"] },
  { entry: "CONF-I22", cases: ["CONF-L2", "CONF-L3"] },
  { entry: "CONF-I23", cases: ["CONF-L4"] },
  { entry: "CONF-I24", cases: ["CONF-L5"] },
  { entry: "CONF-I25", cases: ["CONF-L6"] },
  { entry: "CONF-I26", cases: ["CONF-L7", "CONF-L8"] },
  { entry: "CONF-I27", cases: ["CONF-L9"] },
  { entry: "CONF-I28", cases: ["CONF-L10"] },
  { entry: "CONF-I29", cases: ["CONF-L11"] },
  { entry: "CONF-I30", cases: ["CONF-O23"] },
  { entry: "CONF-I31", cases: ["CONF-L12"] },
  { entry: "CONF-I32", cases: ["CONF-O24"] },
  { entry: "CONF-I33", cases: ["CONF-O25"] },
  { entry: "CONF-I34", cases: ["CONF-O26"] },
  { entry: "CONF-I35", cases: ["CONF-O27"] },
  { entry: "CONF-I36", cases: ["CONF-O28"] },
  { entry: "CONF-I37", cases: ["CONF-O29"] },
  { entry: "CONF-I38", cases: ["CONF-O30"] },
  { entry: "CONF-I39", cases: ["CONF-O31"] },
  { entry: "CONF-I40", cases: ["CONF-O32"] },
  { entry: "CONF-I41", cases: ["CONF-O33"] },
  { entry: "CONF-I42", cases: ["CONF-O34"] },
  { entry: "CONF-I43", cases: ["CONF-O35"] },
  { entry: "CONF-I44", cases: ["CONF-O36"] },
  { entry: "CONF-I45", cases: ["CONF-O37"] },
  { entry: "CONF-I46", cases: ["CONF-O38"] },
  { entry: "CONF-I47", cases: ["CONF-O39"] },
  { entry: "CONF-I49", cases: ["CONF-O40"] },
  { entry: "CONF-I50", cases: ["CONF-O41"] },
  { entry: "CONF-I54", cases: ["CONF-L13"] },
  { entry: "CONF-I56", cases: ["CONF-O42"] },
  { entry: "CONF-I60", cases: ["CONF-O43"] },
  { entry: "CONF-I79", cases: ["CONF-O44"] },
  { entry: "CONF-I80", cases: ["CONF-O45"] },
  { entry: "CONF-I81", cases: ["CONF-O46"] },
];

const ledgerEntryOf = (id: ConformanceCaseId): LedgerEntryId => {
  const citation = ledgerCitations.find((entry) => entry.cases.includes(id));
  if (!citation) {
    throw new Error(`no ledger entry cites the conformance case "${id}"`);
  }
  return citation.entry;
};

const caseIdsCitedBy = (entry: LedgerEntryId): readonly ConformanceCaseId[] => {
  const citation = ledgerCitations.find((candidate) => candidate.entry === entry);
  if (!citation) {
    return [];
  }
  return citation.cases;
};

export { caseIdsCitedBy, conformanceCaseIds, ledgerEntryOf };
export type { ConformanceCaseId, LedgerEntryId };
