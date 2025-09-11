# ---- Base Stage ----
FROM node:20-alpine AS base
WORKDIR /usr/src/app

# ---- Dependencies Stage ----
FROM base AS deps
# Install pnpm
RUN npm install -g pnpm
# Copy dependency-defining files
COPY package.json pnpm-lock.yaml ./
# Install all dependencies (include dev deps for build)
RUN pnpm install

# ---- Build Stage ----
FROM base AS build
RUN npm install -g pnpm
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
# Build the application
RUN pnpm build

# ---- Production Stage ----
FROM base AS production
ENV NODE_ENV production
# Copy built application from the build stage
COPY --from=build /usr/src/app/dist ./dist
# Copy node_modules from build stage to include generated Prisma client
COPY --from=build /usr/src/app/node_modules ./node_modules

# Expose the application port
EXPOSE 3000

# The command to run the application
CMD ["node", "dist/main.js"]
