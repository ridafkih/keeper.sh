import { describe, expect, it } from "bun:test";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";
import { CredentialHealthStateMachine } from "./credential-health.machine";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-cred-${envelopeSequence}`,
    occurredAt: `2026-03-19T13:30:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("CredentialHealthStateMachine", () => {
  it("emits refresh command when expiry is detected", () => {
    const machine = new CredentialHealthStateMachine(
      {
        accessTokenExpiresAt: "2026-03-19T14:00:00.000Z",
        calendarAccountId: "acc-1",
        oauthCredentialId: "cred-1",
      },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );

    const transition = machine.dispatch(
      envelope({ type: "TOKEN_EXPIRY_DETECTED" }, { type: "system", id: "sync" }),
    );

    expect(transition.state).toBe("refresh_required");
    expect(transition.commands).toEqual([{ type: "REFRESH_TOKEN" }]);
  });

  it("persists refreshed credentials on refresh success", () => {
    const machine = new CredentialHealthStateMachine(
      {
        accessTokenExpiresAt: "2026-03-19T14:00:00.000Z",
        calendarAccountId: "acc-2",
        oauthCredentialId: "cred-2",
      },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(envelope({ type: "TOKEN_EXPIRY_DETECTED" }, { type: "system", id: "sync" }));
    machine.dispatch(envelope({ type: "REFRESH_STARTED" }, { type: "system", id: "sync" }));

    const transition = machine.dispatch(
      envelope(
        { newExpiresAt: "2026-03-19T16:00:00.000Z", type: "REFRESH_SUCCEEDED" },
        { type: "system", id: "sync" },
      ),
    );

    expect(transition.state).toBe("token_valid");
    expect(transition.commands).toEqual([
      { expiresAt: "2026-03-19T16:00:00.000Z", type: "PERSIST_REFRESHED_CREDENTIALS" },
    ]);
    expect(transition.outputs).toEqual([{ type: "CREDENTIALS_HEALTHY" }]);
  });

  it("marks reauth required on terminal refresh failure", () => {
    const machine = new CredentialHealthStateMachine(
      {
        accessTokenExpiresAt: "2026-03-19T14:00:00.000Z",
        calendarAccountId: "acc-3",
        oauthCredentialId: "cred-3",
      },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(envelope({ type: "TOKEN_EXPIRY_DETECTED" }, { type: "system", id: "sync" }));
    machine.dispatch(envelope({ type: "REFRESH_STARTED" }, { type: "system", id: "sync" }));

    const transition = machine.dispatch(
      envelope({ code: "invalid_grant", type: "REFRESH_REAUTH_REQUIRED" }, { type: "system", id: "sync" }),
    );

    expect(transition.state).toBe("reauth_required");
    expect(transition.commands).toEqual([{ type: "MARK_ACCOUNT_REAUTH_REQUIRED" }]);
  });

  it("rejects refresh result before refresh started in strict mode", () => {
    const machine = new CredentialHealthStateMachine(
      {
        accessTokenExpiresAt: "2026-03-19T14:00:00.000Z",
        calendarAccountId: "acc-4",
        oauthCredentialId: "cred-4",
      },
      { transitionPolicy: TransitionPolicy.REJECT },
    );

    expect(() =>
      machine.dispatch(
        envelope(
          { newExpiresAt: "2026-03-19T16:00:00.000Z", type: "REFRESH_SUCCEEDED" },
          { type: "system", id: "sync" },
        ),
      ),
    ).toThrow("Transition rejected");
  });

  it("does not emit duplicate refresh command for replayed expiry in ignore mode", () => {
    const machine = new CredentialHealthStateMachine(
      {
        accessTokenExpiresAt: "2026-03-19T14:00:00.000Z",
        calendarAccountId: "acc-5",
        oauthCredentialId: "cred-5",
      },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );

    const first = machine.dispatch(
      envelope({ type: "TOKEN_EXPIRY_DETECTED" }, { type: "system", id: "sync" }),
    );
    const replay = machine.dispatch(
      envelope({ type: "TOKEN_EXPIRY_DETECTED" }, { type: "system", id: "sync" }),
    );

    expect(first.commands).toEqual([{ type: "REFRESH_TOKEN" }]);
    expect(replay.commands).toEqual([]);
    expect(replay.state).toBe("refresh_required");
  });

  it("emits retryable refresh failure output", () => {
    const machine = new CredentialHealthStateMachine(
      {
        accessTokenExpiresAt: "2026-03-19T14:00:00.000Z",
        calendarAccountId: "acc-6",
        oauthCredentialId: "cred-6",
      },
      { transitionPolicy: TransitionPolicy.REJECT },
    );
    machine.dispatch(envelope({ type: "TOKEN_EXPIRY_DETECTED" }, { type: "system", id: "sync" }));
    machine.dispatch(envelope({ type: "REFRESH_STARTED" }, { type: "system", id: "sync" }));

    const transition = machine.dispatch(
      envelope({ code: "upstream_timeout", type: "REFRESH_RETRYABLE_FAILED" }, { type: "system", id: "sync" }),
    );

    expect(transition.state).toBe("refresh_failed_retryable");
    expect(transition.outputs).toEqual([
      { code: "upstream_timeout", type: "CREDENTIALS_REFRESH_RETRYABLE_FAILURE" },
    ]);
  });
});
