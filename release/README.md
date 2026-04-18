# release

Release assets, publishing behavior, and production hardening overview.

## Release Trigger

Tag push matching `vX.Y.Z` triggers release workflow.

## Published Artifacts

- GHCR image: `ghcr.io/<owner>/my-brain:vX.Y.Z`
- GHCR moving tag: `ghcr.io/<owner>/my-brain:latest`
- GitHub release assets:
  - `my-brain-release-vX.Y.Z.tar.gz`
  - `my-brain-release-vX.Y.Z.sha256`

Note: standalone `install.sh` is inside release bundle and repository, not uploaded as dedicated release asset.

## Pipeline Gates

- `yarn lint`
- `yarn format:check`
- `yarn test`
- `yarn build`
- Trivy scan blocks HIGH/CRITICAL vulnerabilities

## Install Paths

Pinned tag installer:

```bash
export MY_BRAIN_VERSION="vX.Y.Z" && \
  curl -fsSL "https://raw.githubusercontent.com/rafaelcmm/my-brain/${MY_BRAIN_VERSION}/release/install.sh" | bash
```

Latest installer from main branch:

```bash
curl -fsSL "https://raw.githubusercontent.com/rafaelcmm/my-brain/main/release/install.sh" \
  | MY_BRAIN_REPO="rafaelcmm/my-brain" bash
```

Full operator procedure: `INSTALL.md`.
