import type { BetterAuthPlugin } from "better-auth";

export const schema: BetterAuthPlugin["schema"] = {
  user: {
    fields: {
      username: {
        required: true,
        type: "string",
        unique: true,
      },
    },
  },
};
