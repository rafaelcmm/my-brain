FROM node:20-bookworm-slim

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv "${VIRTUAL_ENV}" \
 && "${VIRTUAL_ENV}/bin/pip" install --no-cache-dir --upgrade pip \
 && "${VIRTUAL_ENV}/bin/pip" install --no-cache-dir mcp-proxy==0.11.0

WORKDIR /app

COPY src/mcp-bridge/package.json src/mcp-bridge/package-lock.json ./
RUN npm ci

COPY src/mcp-bridge/tsconfig.json ./
COPY src/mcp-bridge/src ./src
RUN npm run build

# --allow-origin must be repeated per origin; comma-separated strings are not split by mcp-proxy.
# Streamable HTTP transport is the default in 0.11.0+ — clients connect to /mcp, not /sse.
CMD ["mcp-proxy", "--host", "0.0.0.0", "--port", "3333", "--pass-environment", "--allow-origin", "http://localhost", "--allow-origin", "http://127.0.0.1", "--", "node", "dist/index.js"]
