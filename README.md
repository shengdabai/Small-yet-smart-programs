# Small-yet-smart-programs

Daily scout for small, profitable, replicable software opportunities — scores them on a 7-dim anti-hype rubric, ships a bilingual briefing.

## Business Context

- **Category:** opportunity research workflow
- **Audience:** indie builders and creators looking for small, testable software opportunities without hype.
- **Repository status:** Public repository. Keep examples, docs, and issues free of credentials, private data, and machine-specific paths.
- **Topics:** ai, bilingual, bun, indie-hacking, indiehackers, opportunity-scanner, side-project, sqlite, typescript, web-scraping

## What This Project Is For

- Daily scout for small, profitable, replicable software opportunities — scores them on a 7-dim anti-hype rubric, ships a bilingual briefing.
- Turn scattered market signals into a repeatable opportunity-scanning process.
- Score ideas against explicit criteria before investing build time.

## Where It Fits

This repository supports the front of the product pipeline: discovering, scoring, and packaging small software opportunities before committing build time.

## Technical Overview

- **Primary language:** HTML
- **Detected stack:** HTML, Node.js, TypeScript
- **Default branch:** `main`
- **Visibility:** `PUBLIC`
- **License:** Other

## Repository Map

- `docs`
- `scripts`
- `.claude`
- `LICENSE`
- `METHODOLOGY.md`
- `README.md`
- `SECURITY.md`
- `bun.lock`
- `config`
- `daily-scan.sh`
- `daily`
- `deploy`

## Quick Start

Use the commands that match the current project state:

```bash
bun install
bun run init
```

| Command | Purpose |
|---|---|
| `bun install` | Install project dependencies. |
| `bun run init` | bun run scripts/db.ts --init |

## Operating Notes

- Keep real credentials out of the repository. Use local environment files, GitHub repository secrets, or the deployment platform secret manager.
- If a `.env.example` file exists, treat it as documentation only; never commit filled-in `.env` files.
- Before publishing screenshots, demos, or client examples, remove private names, internal paths, account IDs, and API endpoints.
- The `Repository Hygiene` workflow is a lightweight guardrail, not a replacement for product-specific tests.

## Delivery Checklist

- [ ] README describes the user, business outcome, and operating boundary.
- [ ] Setup or preview commands are current and do not rely on private machine state.
- [ ] No real secrets, private user data, or machine-local state are tracked.
- [ ] Screenshots, demos, or sample outputs are safe to share publicly when the repository is public.
- [ ] Product-specific tests or smoke checks are documented before production use.

## Roadmap

- Tighten the fastest path from clone to useful demo.
- Add project-specific screenshots, sample outputs, or a short walkthrough where useful.
- Promote repeated manual steps into scripts, tests, or documented workflows.
- Keep security, privacy, and licensing boundaries explicit as the project evolves.

## Maintainer Notes

Maintained by [Tony Sheng](https://github.com/shengdabai). This README is written as a business-facing handoff: it should help a future collaborator, client, or reviewer understand why the repository exists, how to inspect it, and what must be true before it is reused or shipped.
