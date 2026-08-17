import type { CalendarKey } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { Plan } from "@keeper.sh/sync-reconcile";
import { ReconcileInternalDataError } from "@keeper.sh/sync-reconcile";
import { ShadowInternalDataError } from "../errors";
import type { ShadowOptions } from "../options";
import type { Translation, TranslationUnit } from "../translate/unit";
import type { TranslationRefusal } from "../translate/refusal";
import { deletionsOf, forgottenRowsOf } from "./deletions";
import type {
  CatalogCaveat,
  CoverageVerdict,
  CreationEntry,
  DeletionEntry,
  ForgottenRowEntry,
  ReplacementEntry,
  UnresolvedEntry,
  UpdateEntry,
} from "./entries";
import { inSignatureOrder, signatureOf } from "./order";
import { unresolvedOf } from "./unresolved";
import { creationsOf, replacementsOf, updatesOf } from "./writes";

type Catalog =
  | {
      readonly kind: "cataloged";
      readonly destination: CalendarKey;
      readonly deletions: readonly DeletionEntry[];
      readonly replacements: readonly ReplacementEntry[];
      readonly creations: readonly CreationEntry[];
      readonly updates: readonly UpdateEntry[];
      readonly forgottenLocalRows: readonly ForgottenRowEntry[];
      readonly unresolved: readonly UnresolvedEntry[];
      readonly coverage: readonly CoverageVerdict[];
      readonly caveats: readonly CatalogCaveat[];
      readonly identitiesConsidered: number;
      readonly reason?: never;
      readonly invariant?: never;
    }
  | {
      readonly kind: "notTranslated";
      readonly destination: CalendarKey;
      readonly reason: TranslationRefusal;
      readonly detail: string;
      readonly deletions?: never;
      readonly invariant?: never;
    }
  | {
      readonly kind: "plannerRefused";
      readonly destination: CalendarKey;
      readonly sourceCalendar: CalendarKey;
      readonly invariant: string;
      readonly deletions?: never;
      readonly reason?: never;
    }
  | {
      readonly kind: "shadowRefused";
      readonly destination: CalendarKey;
      readonly invariant: string;
      readonly deletions?: never;
      readonly reason?: never;
    };

interface PlannedUnit {
  readonly unit: TranslationUnit;
  readonly plan: Plan;
}

type Planning =
  | { readonly kind: "planned"; readonly planned: readonly PlannedUnit[] }
  | {
      readonly kind: "refused";
      readonly sourceCalendar: CalendarKey;
      readonly invariant: string;
    };

const planUnit = (unit: TranslationUnit, options: ShadowOptions): Planning => {
  try {
    return { kind: "planned", planned: [{ unit, plan: options.plan(unit) }] };
  } catch (error) {
    if (error instanceof ReconcileInternalDataError) {
      return { kind: "refused", sourceCalendar: unit.sourceCalendar, invariant: error.message };
    }
    throw error;
  }
};

const planEveryUnit = (
  units: readonly TranslationUnit[],
  options: ShadowOptions,
): Planning => {
  const planned: PlannedUnit[] = [];
  for (const unit of units) {
    const attempt = planUnit(unit, options);
    if (attempt.kind === "refused") {
      return attempt;
    }
    planned.push(...attempt.planned);
  }
  return { kind: "planned", planned };
};

const refusalOfProof = (unit: TranslationUnit): CoverageVerdict["refusal"] => {
  if (unit.proof.kind === "unproven") {
    return unit.proof.refusal;
  }
  return null;
};

const recordedAtOfProof = (unit: TranslationUnit): CoverageVerdict["recordedAt"] => {
  if (unit.proof.kind === "proven") {
    return unit.proof.recordedAt;
  }
  return null;
};

const ageOfProof = (unit: TranslationUnit): number | null => {
  if (unit.proof.kind === "proven") {
    return unit.proof.ageSeconds;
  }
  return null;
};

const verdictOf = (planned: PlannedUnit): CoverageVerdict => ({
  sourceCalendar: planned.unit.sourceCalendar,
  kind: planned.unit.proof.kind,
  refusal: refusalOfProof(planned.unit),
  listingKind: planned.unit.observed.source.kind,
  recordedAt: recordedAtOfProof(planned.unit),
  ageSeconds: ageOfProof(planned.unit),
  cursor: planned.plan.cursor,
});

const unresolvedSignatureOf = (entry: UnresolvedEntry): string =>
  signatureOf([entry.reason, entry.identityKey ?? "", entry.id?.value ?? ""]);

const forgottenSignatureOf = (entry: ForgottenRowEntry): string =>
  signatureOf([entry.identityKey, entry.cause]);

const identitiesConsideredIn = (planned: readonly PlannedUnit[]): number =>
  planned.reduce((total, unit) => total + unit.plan.diagnostics.identitiesConsidered, 0);

const catalogOfPlanned = (
  translation: Extract<Translation, { kind: "translated" }>,
  planned: readonly PlannedUnit[],
): Catalog => ({
  kind: "cataloged",
  destination: translation.destination,
  deletions: inSignatureOrder(
    planned.flatMap((entry) => deletionsOf(entry)),
    (entry) => entry.signature,
  ),
  replacements: inSignatureOrder(
    planned.flatMap((entry) => replacementsOf(entry)),
    (entry) => entry.signature,
  ),
  creations: inSignatureOrder(
    planned.flatMap((entry) => creationsOf(entry)),
    (entry) => entry.signature,
  ),
  updates: inSignatureOrder(
    planned.flatMap((entry) => updatesOf(entry)),
    (entry) => entry.signature,
  ),
  forgottenLocalRows: inSignatureOrder(
    planned.flatMap((entry) => forgottenRowsOf(entry)),
    forgottenSignatureOf,
  ),
  unresolved: inSignatureOrder(
    planned.flatMap((entry) => unresolvedOf(entry)),
    unresolvedSignatureOf,
  ),
  coverage: planned.map((entry) => verdictOf(entry)),
  caveats: translation.caveats,
  identitiesConsidered: identitiesConsideredIn(planned),
});

const catalogOrShadowRefusal = (
  translation: Extract<Translation, { kind: "translated" }>,
  planned: readonly PlannedUnit[],
): Catalog => {
  try {
    return catalogOfPlanned(translation, planned);
  } catch (error) {
    if (error instanceof ShadowInternalDataError) {
      return {
        kind: "shadowRefused",
        destination: translation.destination,
        invariant: error.message,
      };
    }
    throw error;
  }
};

const catalogTranslated = (
  translation: Extract<Translation, { kind: "translated" }>,
  options: ShadowOptions,
): Catalog => {
  const planning = planEveryUnit(translation.units, options);
  if (planning.kind === "refused") {
    return {
      kind: "plannerRefused",
      destination: translation.destination,
      sourceCalendar: planning.sourceCalendar,
      invariant: planning.invariant,
    };
  }
  return catalogOrShadowRefusal(translation, planning.planned);
};

const catalogTranslation = (translation: Translation, options: ShadowOptions): Catalog => {
  switch (translation.kind) {
    case "refused": {
      return {
        kind: "notTranslated",
        destination: translation.destination,
        reason: translation.reason,
        detail: translation.detail,
      };
    }
    case "translated": {
      return catalogTranslated(translation, options);
    }
    default: {
      return assertNever(translation);
    }
  }
};

export { catalogTranslation };
export type { Catalog };
