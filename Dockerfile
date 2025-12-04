# Use the base image with Node.js
FROM node:22.19-alpine
# Ensure OpenSSL is present so Prisma can pick correct engine binaries
RUN apk add --update --no-cache openssh-client git openssl
# Copy the current directory into the Docker image
COPY . /billing-accounts-api-v6

# Set working directory for future use
WORKDIR /billing-accounts-api-v6

# Install the dependencies from package.json
RUN npm i -g pnpm
RUN pnpm install
RUN pnpm build
RUN pnpm prisma:generate
# Enable Node diagnostic reports and Prisma backtraces for deeper crash insights
ENV RUST_BACKTRACE=1
# Optional: raise Prisma log level from the engine; keep it modest by default
ENV PRISMA_LOG_LEVEL=info

# Copy entrypoint script and make it executable
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Use entrypoint to run migrations at startup (not build time)
# Prisma uses PostgreSQL advisory locks to prevent concurrent migrations
ENTRYPOINT ["/entrypoint.sh"]
