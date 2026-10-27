# ---- Base Stage ----
ARG NODE_VERSION=26.5.1

FROM alpine:3.24 AS base
ARG NODE_VERSION
# Alpine replaces old APK patch versions. Keep the configured Node major while
# accepting maintained patch releases and verify the selected runtime below.
RUN apk upgrade --no-cache \
  && apk add --no-cache "nodejs-current~${NODE_VERSION%%.*}" \
  && test "$(node -p 'process.versions.node.split(".")[0]')" = "${NODE_VERSION%%.*}" \
  && addgroup -S -g 10001 app \
  && adduser -S -D -u 10001 -G app -h /home/app app
WORKDIR /usr/src/app

# ---- Tooling Stage ----
FROM base AS tooling
RUN apk add --no-cache npm \
  && npm install -g pnpm@11.15.1

# ---- Dependencies Stage ----
FROM tooling AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---- Build Stage ----
FROM deps AS build
COPY . .
# Build the application (runs prisma generate via package script)
RUN pnpm build

# ---- Production Dependencies Stage ----
FROM tooling AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
  && ./node_modules/.bin/prisma generate

# ---- Production Stage ----
FROM base AS production
ENV NODE_ENV=production
ENV HOME=/home/app
WORKDIR /usr/src/app

# Copy built artifacts and runtime deps
COPY --chown=app:app --from=build /usr/src/app/dist ./dist
COPY --chown=app:app --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --chown=app:app --from=build /usr/src/app/prisma ./prisma
COPY --chown=app:app --from=build /usr/src/app/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

USER 10001:10001
ENTRYPOINT ["/entrypoint.sh"]
