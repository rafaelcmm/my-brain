# Security Quick Reference

## Emergency Response

### Compromised Token
```bash
# 1. Rotate immediately
./src/scripts/rotate-token.sh

# 2. Restart gateway to reload token
docker compose restart my-brain-gateway

# 3. Verify new token in use
docker logs my-brain-gateway 2>&1 | tail -20

# 4. Update all clients with new token from:
cat .secrets/auth-token
```

### Suspected Brute Force Attack
```bash
# Check for multiple 401s from same IP
docker logs my-brain-gateway 2>&1 | grep "401" | sort | uniq -c

# Check rate limit hits
docker logs my-brain-gateway 2>&1 | grep "429"

# Temporarily block IP at firewall (if binding to 0.0.0.0)
sudo iptables -A INPUT -s <IP> -j DROP
```

### Service Won't Start After Token Rotation
```bash
# Check orchestrator logs for token validation error
docker logs my-brain-orchestrator 2>&1 | grep SECURITY

# Common issues:
# - Token file missing: ensure .secrets/auth-token exists
# - Token too short: must be ≥73 chars
# - Wrong prefix: must start with "my-brain-"
# - Wrong permissions: must be 600

# Fix and restart
./src/scripts/security-check.sh
docker compose restart my-brain-orchestrator
```

---

## Common Tasks

### Validate Security Configuration
```bash
./src/scripts/security-check.sh
```

### Test Rate Limiting
```bash
# Send 100 requests, expect ~60 success + ~40 rate-limited
./src/scripts/test-rate-limit.sh 100 60
```

### Generate New Token
```bash
# Atomic rotation with grace period via .previous file
./src/scripts/rotate-token.sh

# Manual generation (not recommended)
openssl rand -base64 96 | tr -d '/+=\n' | cut -c1-64 | sed 's/^/my-brain-/' > .secrets/auth-token
chmod 600 .secrets/auth-token
```

### Check Token Length
```bash
wc -c < .secrets/auth-token
# Must be ≥73
```

### Verify Security Headers
```bash
curl -I -H "Authorization: Bearer $(cat .secrets/auth-token)" \
  http://127.0.0.1:8080/health | grep -E 'X-Frame|X-Content|Server'
```

### Check Rate Limit Status
```bash
# Send 10 requests quickly
for i in {1..10}; do
  curl -w "%{http_code}\n" -o /dev/null \
    -H "Authorization: Bearer $(cat .secrets/auth-token)" \
    http://127.0.0.1:8080/health
done
```

---

## Configuration Reference

### Environment Variables

```bash
# Token security
MYBRAIN_AUTH_TOKEN_FILE=/run/secrets/auth-token  # Path to token file
MYBRAIN_MIN_TOKEN_LENGTH=73                      # Minimum token chars

# Rate limiting
MYBRAIN_RATE_LIMIT_PER_MIN=60                    # Requests per IP per minute

# Request limits
MYBRAIN_MAX_REQUEST_BODY_BYTES=1048576           # 1MB max request size

# Network binding
MYBRAIN_BIND_HOST=127.0.0.1                      # Localhost-only (safe default)
MYBRAIN_MCP_PORT=3333                            # MCP endpoint port
MYBRAIN_REST_PORT=8080                           # REST API port
```

### File Permissions

```bash
.secrets/           # 700 (drwx------)
.secrets/auth-token # 600 (-rw-------)
```

### Security Headers (Auto-Applied)

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

### Rate Limiting

- **Scope:** Per IP address
- **Window:** 1 minute (sliding)
- **Limit:** 60 requests (default)
- **Response:** HTTP 429 Too Many Requests
- **Applies to:** All endpoints on :3333 and :8080

---

## Troubleshooting

### Error: "SECURITY: auth token file not found"
```bash
# Token file missing or wrong path
ls -la .secrets/auth-token
# Fix: generate new token
./src/scripts/rotate-token.sh
```

### Error: "SECURITY: auth token too short"
```bash
# Token doesn't meet 73-char minimum
wc -c < .secrets/auth-token
# Fix: rotate token
./src/scripts/rotate-token.sh
```

### Error: "SECURITY: auth token must start with 'my-brain-' prefix"
```bash
# Token has wrong format (manual edit or corruption)
head -c 9 .secrets/auth-token
# Fix: regenerate token
./src/scripts/rotate-token.sh
```

### Error: "request body too large"
```bash
# Request exceeds 1MB limit
# Fix: increase limit in .env
MYBRAIN_MAX_REQUEST_BODY_BYTES=2097152  # 2MB
docker compose up -d my-brain-orchestrator
```

### Error: "request timeout"
```bash
# Request took >30 seconds
# Possible slowloris attack or slow client
# Fix: check logs, investigate source IP
docker logs my-brain-gateway | grep timeout
```

### Warning: "caddy rate_limit module not detected"
```bash
# Gateway needs rebuild to include rate_limit module
docker compose build my-brain-gateway
docker compose up -d my-brain-gateway

# Verify module loaded
docker exec my-brain-gateway caddy version
# Should show: rate_limit in modules list
```

---

## Security Checklist (Before Production)

- [ ] Token ≥73 chars: `wc -c < .secrets/auth-token`
- [ ] Token has prefix: `head -c 9 .secrets/auth-token` → `my-brain-`
- [ ] File perms: `ls -la .secrets/` → `700` dir, `600` files
- [ ] DB password changed: `grep MYBRAIN_DB_PASSWORD .env` (not default)
- [ ] Bind host safe: `grep MYBRAIN_BIND_HOST .env` → `127.0.0.1`
- [ ] Rate limiting works: `./src/scripts/test-rate-limit.sh`
- [ ] Security headers: `curl -I http://127.0.0.1:8080/health | grep X-Frame`
- [ ] Token validation runs: `docker logs my-brain-orchestrator | grep "auth token validated"`
- [ ] Security check passes: `./src/scripts/security-check.sh`

---

## File Locations

```
.secrets/auth-token           # Main auth token (mode 600)
.secrets/auth-token.previous  # Previous token (rotation grace period)
.env                          # Environment config (NEVER commit)
.env.example                  # Template with safe defaults

src/gateway/Caddyfile         # Gateway config (auth, rate limit, headers)
src/orchestrator/src/index.mjs # Token validation, request limits
src/scripts/install.sh        # Initial setup (token generation)
src/scripts/rotate-token.sh   # Token rotation
src/scripts/security-check.sh # Automated security validation
src/scripts/test-rate-limit.sh # Rate limiting functional test

SECURITY-REVIEW-REMEDIATION.md # Full security review report
SECURITY-HARDENING-SUMMARY.md  # Implementation summary
SECURITY-QUICK-REFERENCE.md    # This file
```

---

## API Examples

### Authenticated Request
```bash
TOKEN="$(cat .secrets/auth-token)"
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/health
```

### Check Service Status
```bash
curl -H "Authorization: Bearer $(cat .secrets/auth-token)" \
  http://127.0.0.1:8080/v1/status | jq .
```

### Test Rate Limiting
```bash
for i in {1..70}; do
  curl -H "Authorization: Bearer $(cat .secrets/auth-token)" \
    http://127.0.0.1:8080/health
  sleep 0.1
done | grep -c "429"
# Should see ~10 rate-limited responses
```

---

## Log Analysis

### Failed Auth Attempts
```bash
docker logs my-brain-gateway 2>&1 | grep "401 Unauthorized"
```

### Rate Limit Violations
```bash
docker logs my-brain-gateway 2>&1 | grep "429"
```

### Security Events (Orchestrator)
```bash
docker logs my-brain-orchestrator 2>&1 | grep SECURITY
```

### Token Validation at Startup
```bash
docker logs my-brain-orchestrator 2>&1 | grep "auth token validated"
```

---

**Last updated:** 2026-04-20  
**Maintainer:** Security team  
**Review cycle:** Quarterly
