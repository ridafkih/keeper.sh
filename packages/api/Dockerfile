FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun run --filter=@keeper.sh/api build

FROM oven/bun:1 AS runtime
WORKDIR /app

COPY --from=build /app/packages/api/dist ./dist
COPY --from=build /app/packages/database ./database
COPY --from=build /app/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 3001

CMD ["sh", "-c", "cd database && bun run migrate && cd .. && bun run dist/index.js"]
