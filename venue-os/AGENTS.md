<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Shift delivery rules (Codex-facing)

1. One shift per branch and PR.
2. Do not prebuild future shifts.
3. Update `docs/BUILD_STATE.md` every shift.
4. Run relevant validation before finishing.
5. Keep secrets server-only.
6. Do not invent GHL payload details.
7. Postgres is the canonical source of truth for app state.
8. Be deterministic where possible, AI where necessary.
