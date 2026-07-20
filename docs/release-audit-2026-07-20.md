# Release audit — 2026-07-20

## Scope

Final pre-freeze audit of infrastructure, security, repository/documentation, identity, AI behavior, accessibility, and the student/guardian product loops.

## Automated gates

- `npm audit --audit-level=high`
- TypeScript and ESLint with zero warnings
- Vitest coverage thresholds at 80% for statements, branches, functions, and lines
- production Vinext/Cloudflare build
- Playwright student flows
- desktop and mobile horizontal-overflow checks
- automated WCAG 2 A/AA serious/critical violation scan
- keyboard-operable Build Week access
- deterministic student-safety phrase evaluation, including near-match false-positive cases

## Release controls added in this audit

- short-lived, rate-limited judge access into the real `/student` and `/guardian` paths;
- judge resolution to the existing fictional household without mutating Google principal identity records;
- universal Worker-boundary security headers, including HSTS, CSP, COOP, and CORP;
- D1 readiness and release identity in `/api/health`;
- accessible student activity drawer focus management;
- expanded indirect safety-language detection; and
- CI execution of dependency audit and Playwright.

## User-owned gates remaining

- select and add the repository license required by the competition;
- record and upload the final sub-three-minute video;
- paste the private judge code and testing instructions into Devpost;
- paste the correct `/feedback` session ID;
- preview and submit the Devpost entry before the deadline; and
- retain final visual/editorial approval after the deployed smoke.

Final command output, remote migration status, deployed health, and smoke results are appended during release execution.
