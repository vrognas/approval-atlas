# Security policy

approval-atlas is a static website with no backend, no accounts and no personal data. It is a solo, non-commercial project.

## Scope

In scope:
- The website at https://approval-atlas.vrognas.com.
- This repository: code, the CI workflow (`.github/workflows/pipeline.yml`) and the published data files (`site/public/data/`).

Out of scope:
- The data sources — the European Medicines Agency (EMA), the European Commission (Union Register), the U.S. National Library of Medicine (MeSH) and EMBL-EBI (ChEMBL). They are third parties: report problems with their systems to them. Errors in the data can be reported as a normal issue.
- GitHub itself (hosting and CI): report to [GitHub's bug bounty](https://bounty.github.com/).
- Response headers that GitHub Pages cannot set (HSTS on custom domains, `X-Frame-Options` / CSP `frame-ancestors`). They are a documented, accepted risk: see [docs/mvsp.md](docs/mvsp.md).

## Reporting a vulnerability

Use GitHub private vulnerability reporting: the repository's **Security** tab → **Report a vulnerability** (https://github.com/vrognas/approval-atlas/security/advisories/new). Please do not open a public issue for a vulnerability.

Include what is affected (URL or file), steps to reproduce, and the impact you expect.

## What to expect

- Acknowledgement within 7 days.
- A fix within 90 days of confirming the vulnerability; sooner if it is being exploited.
- Disclosure: a public GitHub security advisory once fixed, crediting you if you wish. If an incident affected the published data or code, users are notified on the site and in the README within 72 hours of confirming it.

## Safe harbor

Good-faith security research that follows this policy is welcome. I will not pursue or support legal action against you for it. Please:
- Test only against the site and this repository.
- Do not run denial-of-service or load tests.
- Do not attack the infrastructure of GitHub, EMA, the European Commission, NLM or EMBL-EBI.
- Do not use social engineering or phishing.
- Give me a reasonable time to fix an issue before you disclose it publicly.

If you are unsure whether something is in scope, ask through a private report first.
