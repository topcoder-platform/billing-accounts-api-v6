# ---- Base Stage ----
FROM node:22.19-alpine AS base
RUN apk add --no-cache openssh-client git openssl
WORKDIR /usr/src/app

# ---- Dependencies Stage ----
FROM base AS deps
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Build Stage ----
FROM deps AS build
COPY . .
# Build the application (runs prisma generate via package script)
RUN pnpm build

# ---- Production Stage ----
FROM base AS production
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Copy built artifacts and runtime deps
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/prisma ./prisma
COPY --from=build /usr/src/app/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
