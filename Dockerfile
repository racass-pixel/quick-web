# syntax=docker/dockerfile:1.7

# Build context for this Dockerfile is the PARENT directory containing
# quick-web, quick-protocol and quick-backend side-by-side. Build with:
#
#   cd ~/quick
#   docker build \
#       -f quick-web/Dockerfile \
#       --build-arg VITE_API_URL=https://api.quick-network.vu \
#       -t ghcr.io/racass-pixel/quick-web:latest .
#
# This is required because package.json depends on the sibling repos via
# `file:` paths, and Docker COPY cannot reach outside its build context.

FROM node:24-alpine AS builder
WORKDIR /work

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# quick-protocol/gen/ts has its own package.json with prebuilt dist/ — copy it
# in unchanged so `file:../quick-protocol/gen/ts` resolves.
COPY quick-protocol/gen/ts/ /work/quick-protocol/gen/ts/

# quick-backend/design-tokens is the source-of-truth tokens package. Its dist/
# is committed, so a plain copy is enough.
COPY quick-backend/design-tokens/ /work/quick-backend/design-tokens/

# Web app.
COPY quick-web/ /work/quick-web/

WORKDIR /work/quick-web
RUN pnpm install --frozen-lockfile

# VITE_API_URL is inlined at build time by Vite — it cannot be set at runtime.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm build

# ---- runtime ----
FROM nginx:1.27-alpine
COPY --from=builder /work/quick-web/dist /usr/share/nginx/html
COPY quick-web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
