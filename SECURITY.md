# Security policy

## Supported versions

Security updates are applied on a best-effort basis to the **default branch** (`main`) and released through normal deployment or npm publish flows (for the `synapsesync-mcp` package). There is no separate LTS line today; if that changes, this file will be updated.

## Reporting a vulnerability

**Please do not open a public issue** for undisclosed security vulnerabilities.

Preferred:

1. Open a **[GitHub Security Advisory (private report)](https://github.com/metanmai/synapse/security/advisories/new)** for this repository, if you have access to that feature.

If GitHub reporting is not available:

2. Contact the repository maintainers with enough detail to reproduce or understand the issue (minimal repro, affected component, impact). Use a non-public channel the maintainers advertise (e.g. email on profile, org security contact).

## What to include

- Type of issue (e.g. injection, auth bypass, information leak) and **severity guess** if you can.
- Affected **component** (Worker API, frontend, MCP package, etc.).
- **Steps to reproduce** or proof-of-concept, if safe to share.
- **Version** or commit SHA if not on `main`.

## Our process

- We aim to acknowledge reports within a few business days (volunteer-maintained project; not a SLA).
- We will work on a fix or mitigation and coordinate disclosure with you when ready.
- Public credit is optional and only with your consent.

## Hardening notes for operators

Self-hosters should:

- Keep **Supabase** and **Cloudflare** credentials out of git; use secrets management and `.env` / Wrangler secrets only on machines you trust.
- Restrict **service role** / **service key** usage to the Worker backend, never expose them to browsers.
- Review [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for environment variables and optional services (e.g. embedding service).

Thank you for helping keep Synapse users safe.
