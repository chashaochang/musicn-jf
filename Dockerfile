FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile

# Copy application files
COPY src ./src
COPY public ./public

# Create necessary directories
RUN mkdir -p /config /music/_staging /music/Library

# Expose port
EXPOSE 17890

# Environment variables
ENV PORT=17890 \
    CONFIG_DIR=/config \
    STAGING_DIR=/music/_staging \
    LIBRARY_DIR=/music/Library \
    DEFAULT_SERVICE=migu

# Start the application
CMD ["pnpm", "start"]
