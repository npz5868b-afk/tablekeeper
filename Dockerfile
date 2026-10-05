FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY reservation-core/package*.json ./reservation-core/
RUN npm ci --omit=dev --prefix reservation-core

COPY . .
RUN chmod +x /app/container/entrypoint.sh

EXPOSE 4173
ENTRYPOINT ["/app/container/entrypoint.sh"]

