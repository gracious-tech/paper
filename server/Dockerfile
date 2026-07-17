
# API server image for Cloud Run (this is the only container in the repo). `.bin/deploy_server`
# stages a repo-root-shaped copy at server/deploy/ (only the paths this file COPYs) and deploys
# from there, so these COPY paths stay relative to that staged root, not to this file's location.
# The one image backs both services: 'light' (share/merge) and 'compile' (typst) — SERVER_ROLES
# picks the routes. Assets are NOT baked in: the compile service mounts the public assets
# bucket via a GCS volume (ASSETS_DIR set at deploy time). Requires .bin/typst (setup_typst).

FROM node:24-slim

WORKDIR /app

# Install workspace dependencies (only the packages the server needs)
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY typst/package.json typst/
COPY typst-node/package.json typst-node/
RUN npm ci --workspace server --workspace paper-bible-typst --workspace paper-bible-typst-node \
    --include-workspace-root

# Build the local packages the server imports (dependency order, see .bin/build_typst)
COPY typst/ typst/
COPY typst-node/ typst-node/
RUN for module in typst typst-node; \
    do (cd "$module" && npx tsc); done

# The Typst CLI binary (see .bin/setup_typst) — a harmless ~50MB in the light service's image,
# not worth a second image to avoid
COPY .bin/typst /usr/local/bin/typst

# The server itself (run directly by node — type stripping, no build step)
COPY server/src/ server/src/

ENV NODE_ENV=production
ENV TYPST_PATH=/usr/local/bin/typst
ENV PORT=8080

CMD ["node", "server/src/index.ts"]
