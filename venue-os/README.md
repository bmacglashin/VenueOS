This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Eval runner

This repo now includes a deterministic local eval harness for routing, orchestration, outbound-control, and response-policy regression capture.

```bash
pnpm evals:run
pnpm evals:baseline
```

- `pnpm evals:run` validates fixtures in `evals/cases/` and writes the latest artifact to `evals/results/latest/`.
- `pnpm evals:baseline` refreshes committed snapshots in `evals/baselines/v2/`.
- Reports include overall score, score by route, score by category, and failed-case explanations.
- Detailed fixture authoring notes live in `docs/EVALS.md`.

## Local seed

Two local/dev tenant fixtures can be seeded with:

```bash
npm run seed:mock-tenants
```

- Seeds `veritas` and `harborview-loft`
- Loads a tenant-specific knowledge pack for each venue
- Creates a sample inbound website inquiry plus queued AI draft per tenant for Mission Control isolation checks
- Validation steps live in `docs/runbooks/second-tenant-validation-checklist.md`

## Ops endpoints

Two lightweight operational endpoints are available for launch-day checks and basic automation:

- `GET /api/health` returns liveness/readiness plus config/database check details.
- `GET /api/ops/status` returns shared audit-log counters for inbound received, review queued, outbound sent, outbound blocked, outbound failed, and duplicate dropped.

`/api/ops/status` requires either `Authorization: Bearer <OPS_STATUS_TOKEN>` or `x-ops-token: <OPS_STATUS_TOKEN>`.

## Website inquiries

`POST /api/website-inquiries` validates website-form payloads, persists them to Postgres first, marks summary status, optionally generates a non-blocking AI summary, and can still attempt a downstream sync without blocking success.

Example request payload:

```json
{
  "tenantSlug": "veritas",
  "contactName": "Taylor Brooks",
  "email": "taylor@example.com",
  "phone": "555-555-0100",
  "eventDate": "2026-10-18",
  "guestCount": 140,
  "message": "Looking for availability for an October reception.",
  "source": "website_form"
}
```

- Provide either `tenantId` or `tenantSlug`.
- `eventDate` accepts `YYYY-MM-DD` or ISO 8601 input and is normalized before persistence.
- Summary output is stored separately from `raw_payload` with `summaryStatus`, short summary text, extracted key facts, and a confidence score.
- Successful responses still return `201` if an optional downstream sync fails; inspect the `downstream` object for that status.
- Mission Control exposes the stored raw submission and AI summary at `/mission-control/website-inquiries`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Venue OS Master Plan](./docs/MASTER_PLAN.md) - phased delivery plan for the product build.
- [Go-Live Verification Runbook](./docs/runbooks/go-live-verification.md) - outbound mode, kill-switch, and launch-day verification checklist.
- [Observability Foundation](./docs/observability-foundation.md) - request/trace IDs, structured event names, and operational error taxonomy.
- [Second-Tenant Validation Checklist](./docs/runbooks/second-tenant-validation-checklist.md) - local/dev checklist for dual-tenant seed and isolation verification.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
