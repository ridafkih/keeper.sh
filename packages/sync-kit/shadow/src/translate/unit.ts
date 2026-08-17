import type { CalendarKey } from "@keeper.sh/sync-protocol";
import type {
  KnownState,
  MappingSet,
  ObservedState,
  ReconciliationPolicy,
} from "@keeper.sh/sync-reconcile";
import type { CatalogCaveat } from "../catalog/entries";
import type { SourceCoverageProof } from "../input/stored-coverage";
import type { TranslationRefusal } from "./refusal";

interface TranslationUnit {
  readonly sourceCalendar: CalendarKey;
  readonly observed: ObservedState;
  readonly known: KnownState;
  readonly mappings: MappingSet;
  readonly policy: ReconciliationPolicy;
  readonly proof: SourceCoverageProof;
}

type Translation =
  | {
      readonly kind: "translated";
      readonly destination: CalendarKey;
      readonly units: readonly TranslationUnit[];
      readonly caveats: readonly CatalogCaveat[];
    }
  | {
      readonly kind: "refused";
      readonly destination: CalendarKey;
      readonly reason: TranslationRefusal;
      readonly detail: string;
    };

export type { Translation, TranslationUnit };
