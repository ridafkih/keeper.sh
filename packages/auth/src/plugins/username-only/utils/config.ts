interface UsernameOnlyOptions {
  minUsernameLength?: number;
  maxUsernameLength?: number;
  minPasswordLength?: number;
  maxPasswordLength?: number;
}

type UsernameOnlyConfig = Required<UsernameOnlyOptions>;

const defaultOptions: UsernameOnlyConfig = {
  maxPasswordLength: 128,
  maxUsernameLength: 32,
  minPasswordLength: 8,
  minUsernameLength: 3,
};

const resolveConfig = (options?: UsernameOnlyOptions): UsernameOnlyConfig => ({
  ...defaultOptions,
  ...options,
});

export { resolveConfig };
export type { UsernameOnlyOptions, UsernameOnlyConfig };
