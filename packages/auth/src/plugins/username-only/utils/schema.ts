import type { BetterAuthPlugin } from "better-auth";

export const schema: BetterAuthPlugin["schema"] = {
  user: {
    fields: {
      username: {
        input: false,
        required: false,
        type: "string",
        unique: true,
      },
    },
  },
};
