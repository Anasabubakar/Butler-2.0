# Builds the library website, then runs the Butler server (which also serves the site).
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM denoland/deno:2.5.6
WORKDIR /app
COPY deno.json deno.lock ./
COPY server/ server/
COPY db/ db/
RUN deno cache server/main.ts
COPY --from=web /web/dist web/dist
RUN mkdir -p /data/files && chown -R deno:deno /data
USER deno
ENV FILES_DIR=/data/files PORT=8080
EXPOSE 8080
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write=/data", "--allow-sys", "server/main.ts"]
