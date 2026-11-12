interface CollectorIdentity {
  serviceName: string;
  serviceVersion: string;
  deploymentEnvironment: string;
}

type Environment = Record<string, string | undefined>;

const readRequired = (environment: Environment, key: string, missingKeys: string[]) => {
  const value = environment[key];
  if (!value) {
    missingKeys.push(key);
    return "";
  }
  return value;
};

const readCollectorIdentity = (environment: Environment): CollectorIdentity => {
  const missingKeys: string[] = [];
  const identity = {
    serviceName: readRequired(environment, "OTEL_SERVICE_NAME", missingKeys),
    serviceVersion: readRequired(environment, "VERSION", missingKeys),
    deploymentEnvironment: readRequired(environment, "ENV", missingKeys),
  };
  if (missingKeys.length > 0) {
    throw new Error(`Forwarding logs to a collector requires ${missingKeys.join(", ")}`);
  }
  return identity;
};

export { readCollectorIdentity };
export type { CollectorIdentity };
