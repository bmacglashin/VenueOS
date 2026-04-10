# Venue OS Master Plan

Venue OS is a multi-tenant operations platform designed for venue-first workflows and future med-spa expansion, with Supabase/Postgres as the canonical application state store and GHL treated as an external operating surface. This plan defines phased delivery so each shift is independently reviewable, avoids prebuilding later-shift runtime logic, and keeps the repository aligned with a Next.js App Router structure and server-side secret handling.

## Shift-by-shift checklist (0-13)

- [ ] **Shift 0 — manual setup**
  - **Goal:** Establish baseline project and environment prerequisites.
  - **Scope:** Local repo bootstrap, initial toolchain sanity, manual account/service setup outside runtime implementation.
  - **Target end state:** Team can clone, open, and prepare the repo with known prerequisites.

- [x] **Shift 1 — repo source of truth**
  - **Goal:** Create canonical planning/state docs and scaffold foundational folder structure.
  - **Scope:** `docs/MASTER_PLAN.md`, `docs/BUILD_STATE.md`, root `AGENTS.md` codex rules, and core directories for API/services/lib/data/scripts/supabase.
  - **Target end state:** Repository has clear build governance and reusable structural scaffolding with no later-shift runtime logic.

- [x] **Shift 2 — dependencies + config**
  - **Goal:** Add required packages and baseline config contracts.
  - **Scope:** Dependency installation decisions, environment variable schema, and safe configuration wiring.
  - **Target end state:** Project dependencies/config are in place for subsequent implementation shifts.

- [x] **Shift 3 — AI service**
  - **Goal:** Establish AI service abstraction layer.
  - **Scope:** LLM client interfaces, server-side provider wiring, deterministic failover/error handling patterns.
  - **Target end state:** Reusable AI service can be invoked by higher-level workflows.

- [x] **Shift 4 — knowledge loading + caching**
  - **Goal:** Ingest and cache knowledge for low-latency use.
  - **Scope:** Knowledge loaders, cache strategy, invalidation/update approach.
  - **Target end state:** Structured knowledge is loadable and cached predictably.

- [x] **Shift 5 — structured routing**
  - **Goal:** Implement structured request-routing for operations.
  - **Scope:** Route classification/dispatch patterns, typed contracts, minimal orchestration paths.
  - **Target end state:** Requests are routed deterministically with clear extension points.

- [x] **Shift 6 — Supabase schema**
  - **Goal:** Define canonical data model in Supabase/Postgres.
  - **Scope:** Core tables, relationships, constraints, RLS policy planning/migrations.
  - **Target end state:** Canonical app-state schema is migration-managed and reviewable.

- [ ] **Shift 7 — Supabase clients + services**
  - **Goal:** Implement data-access services against canonical schema.
  - **Scope:** Server/client Supabase initialization and typed service wrappers.
  - **Target end state:** Business flows can read/write canonical state through reusable services.

- [ ] **Shift 8 — memory MVP**
  - **Goal:** Deliver initial memory layer.
  - **Scope:** Minimal persistence/retrieval loop and usage boundaries.
  - **Target end state:** System can store and recall core contextual memory safely.

- [ ] **Shift 9 — internal webhook loop**
  - **Goal:** Add internal event/webhook processing loop.
  - **Scope:** Inbound/outbound internal webhook handling, verification, retries/idempotency groundwork.
  - **Target end state:** Internal automation loop operates with observable handoffs.

- [ ] **Shift 10 — Mission Control v0**
  - **Goal:** Introduce first Mission Control UI surface.
  - **Scope:** App Router page/component scaffolding, status views, thin integration points.
  - **Target end state:** Operators can access an initial control panel with core visibility.

- [ ] **Shift 11 — tenant seeder**
  - **Goal:** Add deterministic tenant bootstrap tooling.
  - **Scope:** Seed scripts/data patterns for venue and future med-spa tenants.
  - **Target end state:** New tenants can be initialized consistently for development/testing.

- [ ] **Shift 12 — QA golden dataset**
  - **Goal:** Create stable QA fixtures and validation baseline.
  - **Scope:** Golden dataset creation, reproducible checks, expected outcomes.
  - **Target end state:** QA can validate key flows against consistent known data.

- [ ] **Shift 13 — Monday GHL live wiring**
  - **Goal:** Connect production-intent GHL integrations.
  - **Scope:** Final external wiring, contract verification, operational readiness checks.
  - **Target end state:** GHL live pathways are integrated while Postgres remains canonical truth.
