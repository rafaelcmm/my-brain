#!/usr/bin/env bash
# my-brain installer — CPU-only wrapper.
# Forces MYBRAIN_CPU_ONLY=true so install.sh bypasses docker-compose.override.yml
# (which reserves NVIDIA GPUs). Use on hosts without the NVIDIA container runtime.
#
# One-line bootstrap:
#   curl -fsSL <install-cpu-url> | bash
set -euo pipefail
MYBRAIN_CPU_ONLY=true exec "$(dirname "$0")/install.sh" "$@"
