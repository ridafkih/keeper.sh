import { describe, expect, it } from "bun:test";
import { TransitionPolicy } from "@keeper.sh/state-machines";
import { createSourceProvisioningDispatcher } from "./source-provisioning-dispatcher";

describe("createSourceProvisioningDispatcher", () => {
  it("emits bootstrap requested output on happy path", () => {
    const dispatcher = createSourceProvisioningDispatcher({
      actorId: "api-test",
      mode: "create_single",
      provider: "google",
      requestId: "req-1",
      transitionPolicy: TransitionPolicy.REJECT,
      userId: "user-1",
    });

    dispatcher.dispatch({ type: "VALIDATION_PASSED" });
    dispatcher.dispatch({ type: "QUOTA_ALLOWED" });
    dispatcher.dispatch({ type: "DEDUPLICATION_PASSED" });
    dispatcher.dispatch({ accountId: "account-1", type: "ACCOUNT_CREATED" });
    dispatcher.dispatch({ sourceIds: ["source-1"], type: "SOURCE_CREATED" });
    const completion = dispatcher.dispatch({
      mode: "create_single",
      sourceIds: ["source-1"],
      type: "BOOTSTRAP_SYNC_TRIGGERED",
    });

    expect(completion.outputs).toContainEqual({
      mode: "create_single",
      sourceIds: ["source-1"],
      type: "BOOTSTRAP_REQUESTED",
    });
  });

  it("rejects when quota denied", () => {
    const dispatcher = createSourceProvisioningDispatcher({
      actorId: "api-test",
      mode: "create_single",
      provider: "ics",
      requestId: "req-2",
      transitionPolicy: TransitionPolicy.REJECT,
      userId: "user-2",
    });

    dispatcher.dispatch({ type: "VALIDATION_PASSED" });
    const transition = dispatcher.dispatch({ type: "QUOTA_DENIED" });

    expect(transition.state).toBe("rejected");
    expect(transition.context.rejectionReason).toBe("limit");
  });
});
