# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install dependencies (including devDependencies needed for the build).
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend.
COPY . .
RUN npm run build

# Drop dev deps for the runtime image.
RUN npm prune --omit=dev

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_DIR=/data

# better-sqlite3 ships prebuilt binaries; no system deps needed at runtime.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json

EXPOSE 8787
CMD ["node", "server/index.js"]
