# Homeroom security

Homeroom is a Build Week prototype that handles fictional student data in its public review environment. Do not connect production student records or reuse real credentials in issue reports.

## Report a vulnerability

Use GitHub's private **Report a vulnerability** flow for this repository. Do not open a public issue containing credentials, OAuth codes, private calendar URLs, student data, session cookies, or exploit details.

Include the affected route or component, reproduction steps using fictional data, expected versus observed behavior, and the smallest useful log excerpt with secrets removed.

## Supported release

Only the currently deployed Build Week release is supported. Security-sensitive changes are gated by:

- exact Google identity allowlists or short-lived, secret-protected judge identities;
- role-bound signed cookies, same-origin and CSRF checks;
- D1-backed rate limits on public and model-spending endpoints;
- encrypted source credentials and per-redirect SSRF revalidation;
- read-only provider scopes and server-authoritative write boundaries;
- dependency audit, unit/coverage, build, Playwright, mobile overflow, and WCAG A/AA release checks; and
- universal response headers at the Worker boundary.

The public reviewer environment must contain only fictional data. A production student-information deployment would require a separate privacy/legal review, data-retention policy, incident response process, and school/district authorization.
