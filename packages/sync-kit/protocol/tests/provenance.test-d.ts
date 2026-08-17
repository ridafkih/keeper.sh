import { describe, expectTypeOf, test } from "vitest";
import { assertNever } from "../src/index";
import type {
  BuildMirrorIntent,
  CalendarKey,
  ForeignEvent,
  IndeterminateEvent,
  MirrorSource,
  NormalizedContent,
  OwnEvent,
  Provenance,
  RemoteEvent,
} from "../src/index";

declare const ownEvent: OwnEvent;
declare const indeterminateEvent: IndeterminateEvent;
declare const destination: CalendarKey;
declare const normalized: NormalizedContent<"google">;
declare const buildMirrorIntent: BuildMirrorIntent<"google">;

describe("our own writes never travel back around the loop", () => {
  test("an OwnEvent is not assignable to a mirror write-intent builder", () => {
    // @ts-expect-error re-mirroring our own mirror doubles the event on every run
    buildMirrorIntent(ownEvent, destination, normalized);
  });

  test("an IndeterminateEvent is not assignable either", () => {
    // @ts-expect-error unknown provenance must not default to "theirs"
    buildMirrorIntent(indeterminateEvent, destination, normalized);
  });

  test("only a ForeignEvent is a mirror source", () => {
    expectTypeOf<MirrorSource>().toEqualTypeOf<ForeignEvent>();
    expectTypeOf<ForeignEvent["provenance"]>().toEqualTypeOf<{ readonly kind: "foreign" }>();
    expectTypeOf<OwnEvent["provenance"]["kind"]>().toEqualTypeOf<"ours">();
  });

  test("a provenance switch that omits indeterminate fails to compile", () => {
    const isMirrorable = (event: RemoteEvent): boolean => {
      switch (event.provenance.kind) {
        case "foreign": {
          return true;
        }
        case "ours": {
          return false;
        }
        default: {
          // @ts-expect-error the safe answer for undetectable provenance must be a decision
          return assertNever(event.provenance);
        }
      }
    };
    expectTypeOf(isMirrorable).returns.toBeBoolean();
  });

  test("an own event names the installation that authored it", () => {
    expectTypeOf<Extract<Provenance, { kind: "ours" }>>().toHaveProperty("installation");
    expectTypeOf<Extract<Provenance, { kind: "indeterminate" }>>().toEqualTypeOf<{
      readonly kind: "indeterminate";
    }>();
  });
});
