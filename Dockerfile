FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --no-frozen-lockfile
COPY apps/api apps/api
COPY apps/admin apps/admin
COPY packages/contracts packages/contracts
RUN pnpm --filter @bj/admin build && pnpm --filter @bj/api build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
RUN apk add --no-cache curl && corepack enable
COPY --from=build /workspace /workspace
EXPOSE 4100
CMD ["node", "apps/api/dist/server.js"]
