type AgentFeedbackAvailability = (userId: string) => Promise<boolean>;

interface AgentFeedbackAvailabilityOptions {
  instanceDisabled: boolean;
  readUserPreference: AgentFeedbackAvailability;
}

const createAgentFeedbackAvailability = ({
  instanceDisabled,
  readUserPreference,
}: AgentFeedbackAvailabilityOptions): AgentFeedbackAvailability => {
  if (instanceDisabled) {
    return () => Promise.resolve(false);
  }
  return readUserPreference;
};

export { createAgentFeedbackAvailability };
export type { AgentFeedbackAvailability };
