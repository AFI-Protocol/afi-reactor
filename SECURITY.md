# Security Policy

## 🔒 Reporting Security Vulnerabilities

If you discover a security vulnerability in AFI Reactor, please report it privately:

- **Email**: security@afi-protocol.io (or contact repo maintainers directly)
- **Do NOT** open public GitHub issues for security vulnerabilities
- Include detailed steps to reproduce and potential impact

We will respond within 48 hours and work with you to address the issue.

---

## 🛡️ Security Incident: MongoDB Credentials Exposure (December 2025)

### What Happened

On December 15, 2025, MongoDB Atlas alerted us that database credentials were exposed in the public GitHub repository in a historical commit (`d01b5d0a0db9b7b502b30533bf4cfc210dce27b0`).

**Exposed file**: `start-server-with-mongo.sh` (created Dec 10, 2025, removed before merge to main)

**Affected commit**: `d01b5d0` in branch `docs/branch-doctrine-and-replay-spec`

**Status**: ✅ **RESOLVED**

### What We Did

1. **Immediate Response**:
   - Rotated the exposed MongoDB credentials immediately
   - Verified the credentials were NOT in the `main` branch (file was deleted before merge)
   - Confirmed no unauthorized database access occurred

2. **Git History Cleanup**:
   - Purged the exposed credentials from all git history using `git filter-repo`
   - Force-pushed cleaned history to GitHub
   - Updated all branch references

3. **Prevention Measures**:
   - Added `.env.example` with safe placeholder values
   - Verified `.env` is in `.gitignore` (already present)
   - Added GitHub Actions secret scanner (gitleaks) to CI pipeline
   - Added pre-commit hook template for local secret scanning
   - Documented secure credential management practices

### Impact Assessment

- **Scope**: Single commit in feature branch (never merged to main)
- **Exposure Window**: Dec 10-15, 2025 (5 days)
- **Data Access**: No evidence of unauthorized access
- **Credentials**: Rotated and invalidated

### Timeline

- **Dec 10, 2025**: Credentials committed in `d01b5d0`
- **Dec 15, 2025**: MongoDB Atlas security alert received
- **Dec 15, 2025**: Credentials rotated, history cleaned, preventions added

---

## 🔐 Secure Credential Management

### Environment Variables

**NEVER commit credentials to git.** Use environment variables instead:

1. **Copy the example file**:
   ```bash
   cp .env.example .env
   ```

2. **Fill in your actual credentials** in `.env`:
   ```bash
   AFI_MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/...
   ```

3. **Verify `.env` is gitignored**:
   ```bash
   git check-ignore .env  # Should output: .env
   ```

### MongoDB Security Best Practices

1. **Use strong, unique passwords** (20+ characters, random)
2. **Enable IP allowlist** in MongoDB Atlas (restrict to known IPs)
3. **Use separate credentials** for dev/staging/production
4. **Rotate credentials regularly** (every 90 days minimum)
5. **Use read-only credentials** where write access isn't needed
6. **Enable MongoDB Atlas audit logs** for production

### Secret Scanning

This repository now includes automated secret scanning:

- **GitHub Actions**: Runs `gitleaks` on every push/PR
- **Pre-commit hook** (optional): Install locally to catch secrets before commit

To install the pre-commit hook:
```bash
cp scripts/pre-commit.sample .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

---

## 📋 Security Checklist for Contributors

Before committing code:

- [ ] No hardcoded credentials (API keys, passwords, tokens)
- [ ] No connection strings with embedded credentials
- [ ] All secrets use environment variables
- [ ] `.env` file is in `.gitignore`
- [ ] No sensitive data in commit messages
- [ ] Pre-commit hook installed (optional but recommended)

---

## 🚨 What to Do If You Accidentally Commit a Secret

1. **DO NOT** just delete the file and commit again (secret remains in history)
2. **Immediately rotate** the exposed credential
3. **Contact the security team** or repo maintainers
4. **Use `git filter-repo`** or BFG to remove from history (we can help)
5. **Force-push** the cleaned history (requires coordination)

---

## 📚 Additional Resources

- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [MongoDB Atlas Security](https://www.mongodb.com/docs/atlas/security/)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [git-filter-repo Documentation](https://github.com/newren/git-filter-repo)

---

**Last Updated**: December 15, 2025

