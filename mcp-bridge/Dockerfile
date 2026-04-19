FROM node:20-bookworm-slim

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv "${VIRTUAL_ENV}" \
 && "${VIRTUAL_ENV}/bin/pip" install --no-cache-dir --upgrade pip \
 && "${VIRTUAL_ENV}/bin/pip" install --no-cache-dir mcp-proxy==0.9.0

WORKDIR /app

CMD ["mcp-proxy", "--host", "0.0.0.0", "--port", "3333", "--pass-environment", "--allow-origin", "http://localhost,http://127.0.0.1", "--", "npx", "-y", "ruvector", "mcp", "start"]
