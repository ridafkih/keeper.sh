import { describe, expect, it } from "bun:test";
import { CredentialHealthStateMachine, TransitionPolicy } from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { CredentialHealthOrchestrator } from "./credential-health-orchestrator";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return {
        actor,
        event,
        id: `env-credential-${sequence}`,
        occurredAt: `2026-03-19T15:00:${String(sequence).padStart(2, "0")}.000Z`,
      };
    },
  };
};

describe("CredentialHealthOrchestrator", () => {
  it("requests refresh when token expiry is detected", () => {
    const orchestrator = new CredentialHealthOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new CredentialHealthStateMachine(
        {
          accessTokenExpiresAt: "2026-03-19T15:20:00.000Z",
          calendarAccountId: "acct-1",
          oauthCredentialId: "cred-1",
        },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    const transition = orchestrator.handleTransition({
      actorId: "worker-1",
      type: "TOKEN_EXPIRY_DETECTED",
    });

    expect(transition.state).toBe("refresh_required");
    expect(transition.commands).toEqual([{ type: "REFRESH_TOKEN" }]);
  });

  it("marks account reauth required on terminal refresh failure", () => {
    const orchestrator = new CredentialHealthOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new CredentialHealthStateMachine(
        {
          accessTokenExpiresAt: "2026-03-19T15:20:00.000Z",
          calendarAccountId: "acct-1",
          oauthCredentialId: "cred-1",
        },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    orchestrator.handleTransition({
      actorId: "worker-1",
      type: "TOKEN_EXPIRY_DETECTED",
    });
    orchestrator.handleTransition({
      actorId: "worker-1",
      type: "REFRESH_STARTED",
    });
    const transition = orchestrator.handleTransition({
      actorId: "worker-1",
      code: "invalid_grant",
      type: "REFRESH_REAUTH_REQUIRED",
    });

    expect(transition.state).toBe("reauth_required");
    expect(transition.commands).toEqual([{ type: "MARK_ACCOUNT_REAUTH_REQUIRED" }]);
  });

  it("rejects refresh result before refresh start in strict mode", () => {
    const orchestrator = new CredentialHealthOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new CredentialHealthStateMachine(
        {
          accessTokenExpiresAt: "2026-03-19T15:20:00.000Z",
          calendarAccountId: "acct-1",
          oauthCredentialId: "cred-1",
        },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    expect(() =>
      orchestrator.handleTransition({
        actorId: "worker-1",
        newExpiresAt: "2026-03-19T16:00:00.000Z",
        type: "REFRESH_SUCCEEDED",
      }),
    ).toThrow("Transition rejected");
  });
});
