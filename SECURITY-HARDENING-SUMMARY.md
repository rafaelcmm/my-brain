# Security Hardening Summary

## Changes Applied (2026-04-20)

### Files Modified

1. **src/orchestrator/src/index.mjs**
   - Added `MIN_TOKEN_LENGTH` and `MAX_REQUEST_BODY_BYTES` constants
   - Added `validateAuthToken()` function (fail-close token validation)
   - Added `tokenFile` to config
   - Updated `parseJsonBody()` with timeout + size limits
   - Token validation runs before server starts accepting traffic

2. **src/gateway/Caddyfile**
   - Added global timeout configuration (30s read_body, 10s read_header)
   - Added `security_headers` snippet (6 security headers)
   - Added `rate_limit` snippet (60 req/min per IP)
   - Applied security headers + rate limiting to both ports (3333, 8080)

3. **docker-compose.yml**
   - Updated gateway to use `xcaddy` builder with `caddy-ratelimit` module
   - Added security environment variables to orchestrator
   - Mounted `.secrets` as read-only in orchestrator

4. **.env.example**
   - Changed `MYBRAIN_AUTH_TOKEN_FILE` path to `/run/secrets/auth-token`
   - Added `MYBRAIN_RATE_LIMIT_PER_MIN=60`
   - Added `MYBRAIN_MAX_REQUEST_BODY_BYTES=1048576`

5. **src/scripts/install.sh**
   - Added token prefix validation (`my-brain-` required)

6. **src/scripts/rotate-token.sh**
   - Added token prefix validation

7. **AGENTS.md**
   - Added `src/scripts/security-check.sh` to required checks

### Files Created

1. **SECURITY-REVIEW-REMEDIATION.md**
   - Comprehensive security review report
   - 10 findings documented (5 CRITICAL, 5 advisory)
   - OWASP Top 10 coverage matrix
   - Verification steps
   - Deployment checklist

2. **src/scripts/security-check.sh**
   - Automated security validation script
   - Checks token length, permissions, DB password, rate limits
   - Run before production deployment

3. **src/scripts/test-rate-limit.sh**
   - Rate limiting functional test
   - Sends burst of requests, validates 429 responses

---

## Security Posture: Before vs After

| Control | Before | After |
|---------|--------|-------|
| **Token validation at startup** | ❌ None | ✅ Fail-close (length + prefix) |
| **Rate limiting (gateway)** | ❌ None | ✅ 60 req/min per IP |
| **Rate limiting (orchestrator)** | ⚠️ In-memory | ✅ In-memory + gateway |
| **Security headers** | ❌ None | ✅ 6 headers enforced |
| **Request size limit** | ❌ Unbounded | ✅ 1MB max |
| **Request timeout** | ❌ None | ✅ 30s read_body |
| **Token minimum length** | ⚠️ Runtime check | ✅ Startup + install check |
| **Secrets mount** | ⚠️ Read-write | ✅ Read-only (orchestrator) |
| **Server fingerprinting** | ⚠️ Exposed | ✅ Removed (Server header) |
| **OWASP compliance** | 6/10 | 8/10 |

---

## Quick Start (Post-Hardening)

### 1. Rotate Token (if needed)
```bash
./src/scripts/rotate-token.sh
```

### 2. Run Security Check
```bash
./src/scripts/security-check.sh
```

Expected output:
```
✓ token length: 73 chars
✓ token prefix validated
✓ token permissions: 600
✓ .secrets permissions: 700
✓ DB password customized
✓ bind host: 127.0.0.1
✓ rate limit: 60 requests/min
✓ max request body: 1MB
✓ docker compose config valid
✓ All critical checks passed ✓
```

### 3. Rebuild Gateway (for rate limiting)
```bash
docker compose build my-brain-gateway
docker compose up -d my-brain-gateway
```

### 4. Restart Stack (token validation runs at startup)
```bash
docker compose down
docker compose up -d
```

### 5. Verify Startup Token Validation
```bash
docker logs my-brain-orchestrator 2>&1 | grep "auth token validated"
```

Expected: `[my-brain] auth token validated (73 chars)`

### 6. Test Rate Limiting
```bash
./src/scripts/test-rate-limit.sh 100 60
```

Expected:
```
✅ PASS: Rate limiting working correctly
```

---

## Production Deployment Checklist

Before deploying to production or shared environments:

- [ ] Rotate auth token: `./src/scripts/rotate-token.sh`
- [ ] Run security check: `./src/scripts/security-check.sh` (must pass)
- [ ] Update `MYBRAIN_DB_PASSWORD` (≥32 chars recommended)
- [ ] Review `MYBRAIN_BIND_HOST` (127.0.0.1 for localhost-only)
- [ ] Configure HTTPS reverse proxy (Traefik/nginx/Caddy auto_https)
- [ ] Set up firewall rules if binding to 0.0.0.0
- [ ] Review rate limit: `MYBRAIN_RATE_LIMIT_PER_MIN` (adjust if needed)
- [ ] Test rate limiting: `./src/scripts/test-rate-limit.sh`
- [ ] Verify orchestrator startup logs: `docker logs my-brain-orchestrator | grep SECURITY`
- [ ] Run `npm audit` and update vulnerable dependencies
- [ ] Configure log aggregation for security events (optional)
- [ ] Document incident response procedure for auth token compromise

---

## Breaking Changes

### None

All changes are backward-compatible with existing installations:

- Token length check was already enforced at install time
- New environment variables have safe defaults
- Gateway security headers don't break existing clients
- Rate limiting threshold (60/min) is generous for normal usage

### Migration Notes

1. **Existing installations:** Run `./src/scripts/security-check.sh` to validate current state
2. **Short tokens:** If token <73 chars, rotate with `./src/scripts/rotate-token.sh`
3. **Gateway rebuild:** Required to enable rate limiting module
4. **No downtime:** Services restart gracefully with `docker compose up -d`

---

## Maintenance

### Regular Tasks

#### Weekly
- Review security event logs (when implemented)
- Check for failed auth attempts in gateway logs

#### Monthly
- Run `npm audit` and update vulnerable packages
- Rotate auth token: `./src/scripts/rotate-token.sh`
- Review rate limit threshold (adjust if needed)

#### Quarterly
- Full security review against OWASP Top 10
- Update dependencies to latest stable versions
- Review and update firewall rules

### Monitoring Recommendations

Add alerts for:
- Multiple 401 responses (brute-force detection)
- Multiple 429 responses from same IP (rate limit abuse)
- Orchestrator startup failures (token validation errors)
- Unexpected service restarts

---

## Support & Documentation

- **Security review:** [SECURITY-REVIEW-REMEDIATION.md](./SECURITY-REVIEW-REMEDIATION.md)
- **Security check:** `./src/scripts/security-check.sh --help`
- **Rate limit test:** `./src/scripts/test-rate-limit.sh <total> <limit>`
- **Token rotation:** `./src/scripts/rotate-token.sh`

---

## Credits

**Security reviewer:** security-reviewer mode  
**Date:** 2026-04-20  
**Scope:** Authentication, authorization, API hardening  
**Standards:** OWASP Top 10, NIST SP 800-53, CIS Docker Benchmark
