import arkenv, { type createEnv, type type } from "arkenv";
import { WideEvent } from "@keeper.sh/log";
import type { MaybePromise } from "bun";

type ArkEnvSchemaDefinition = Parameters<typeof createEnv>[0];

type GetEnvFromSchema<ArkEnvSchema extends ArkEnvSchemaDefinition> = ReturnType<
  typeof type<ArkEnvSchema>
>["inferOut"];

type SetupCallback<ArkEnvSchema extends ArkEnvSchemaDefinition> = (options: {
  env: GetEnvFromSchema<ArkEnvSchema>;
}) => MaybePromise<unknown>;

type RunCallback<
  ArkEnvSchema extends ArkEnvSchemaDefinition,
  Extension extends Record<string, unknown>,
> = (options: EntryPointContext<ArkEnvSchema> & Extension) => MaybePromise<unknown>;

interface EntryPointContext<ArkEnvSchema extends ArkEnvSchemaDefinition> {
  env: GetEnvFromSchema<ArkEnvSchema>;
  context: Map<string, unknown>;
  flags: Set<string>;
}

type EntryPointRunFunction<
  CallbackSchema extends ArkEnvSchemaDefinition,
  SetupFunctionReturn extends Record<string, unknown>,
> = (callback: RunCallback<CallbackSchema, SetupFunctionReturn>) => Promise<void>;

const isObjectWithKeysOfType = <TTarget>(env: unknown): env is TTarget => {
  if (!env) {
    return false;
  }
  if (typeof env !== "object") {
    return false;
  }
  if (Object.keys(env).some((key) => typeof key !== "string")) {
    return false;
  }
  return true;
};

const serializeContext = (context: Map<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(context.entries());

const serializeFlags = (flags: Set<string>): string[] => [...flags];

const EXIT_CODE_FAILURE = 1;

const emitLifecycleEvent = (
  service: string,
  startedAt: number,
  context: Map<string, unknown>,
  flags: Set<string>,
  error?: unknown,
): void => {
  const event = new WideEvent();
  event.set({
    "operation.type": "lifecycle",
    "operation.name": `${service}:start`,
    "service.name": service,
    "service.flags": serializeFlags(flags),
    ...serializeContext(context),
  });

  if (error) {
    event.addError(error);
  }

  event.emit();
};

/**
 * A wrapper around long-living service entry-points.
 * Implements the wide events pattern - accumulates context throughout
 * the lifecycle and emits a single canonical log line on completion.
 *
 * @param timeout The number of milliseconds to wait before timing out
 */
const entry = (timeout = 5000) => {
  const serviceBoundary = "entry-point";
  const context = new Map<string, unknown>();
  const flags = new Set<string>();
  const startedAt = Date.now();

  const timeoutId = setTimeout(() => {
    flags.add("timed-out");
    context.set("error.type", "EntryPointTimeout");
    context.set("error.message", `Entry point did not complete within ${timeout}ms`);
    emitLifecycleEvent(serviceBoundary, startedAt, context, flags);
    process.exit(EXIT_CODE_FAILURE);
  }, timeout);

  flags.add("started");
  context.set("timeout", timeout);

  return {
    env<const ArkEnvSchema extends ArkEnvSchemaDefinition>(schema: ArkEnvSchema) {
      const run: EntryPointRunFunction<ArkEnvSchema, Record<never, never>> = async (
        runCallback,
      ) => {
        try {
          flags.add("env-validating");
          const env = arkenv(schema);

          if (!isObjectWithKeysOfType<GetEnvFromSchema<ArkEnvSchema>>(env)) {
            throw new Error(
              "There was an issue validating the environment structure type, this should never happen.",
            );
          }

          flags.add("env-validated");
          flags.add("running");

          await runCallback({
            env,
            context,
            flags,
          });

          flags.add("completed");
          clearTimeout(timeoutId);
          emitLifecycleEvent(serviceBoundary, startedAt, context, flags);
        } catch (error) {
          flags.add("failed");
          clearTimeout(timeoutId);
          emitLifecycleEvent(serviceBoundary, startedAt, context, flags, error);
          process.exit(EXIT_CODE_FAILURE);
        }
      };

      const setup = <
        InstantiatedSetupCallback extends SetupCallback<ArkEnvSchema>,
        InstantiatedSetupCallbackReturnType extends ReturnType<InstantiatedSetupCallback>,
      >(
        callback: InstantiatedSetupCallback,
      ) => {
        type AwaitedSetupResult = Awaited<InstantiatedSetupCallbackReturnType>;

        type SetupExtension = AwaitedSetupResult extends Record<string, unknown>
          ? AwaitedSetupResult
          : Record<never, never>;

        const validateEnvironment = () => {
          flags.add("env-validating");
          const env = arkenv(schema);

          const isValid = isObjectWithKeysOfType<Parameters<typeof callback>[0]["env"]>(env);

          if (!isValid) {
            throw new Error(
              "There was an issue validating the environment structure type, this should never happen.",
            );
          }

          return env;
        };

        const onRun: EntryPointRunFunction<ArkEnvSchema, SetupExtension> = async (runCallback) => {
          try {
            const env = validateEnvironment();
            flags.add("env-validated");
            flags.add("setup-running");

            const setupResult = await callback({ env });

            if (!isObjectWithKeysOfType<SetupExtension>(setupResult)) {
              throw new Error("Setup callback must return an object with string keys.");
            }

            flags.add("setup-completed");
            flags.add("running");

            await runCallback({
              env,
              context,
              flags,
              ...setupResult,
            });

            flags.add("completed");
            clearTimeout(timeoutId);
            emitLifecycleEvent(serviceBoundary, startedAt, context, flags);
          } catch (error) {
            flags.add("failed");
            clearTimeout(timeoutId);
            emitLifecycleEvent(serviceBoundary, startedAt, context, flags, error);
            process.exit(EXIT_CODE_FAILURE);
          }
        };

        return { run: onRun };
      };

      return {
        setup,
        run,
      };
    },
  };
};

export { entry };
export type { ArkEnvSchemaDefinition, GetEnvFromSchema, EntryPointContext };
