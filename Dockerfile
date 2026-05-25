# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS builder
WORKDIR /app

# Enable corepack to use pinned pnpm version from packageManager field if present.
RUN corepack enable

# Copy lockfile + manifest first for better layer caching.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the rest of the source.
COPY . .

# VITE_API_URL must be passed as a build argument because Vite inlines
# import.meta.env.* values at build time, not runtime.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm build

# ---- runtime ----
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
