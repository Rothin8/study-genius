# Solution.AI — Export Specification Pack

Goal: produce a complete, portable spec of the app as it exists today, filling in every section of your template, plus a schema dump so another tool can recreate the database exactly. No app code changes.

Important correction to your premise: the database layer here is **not** missing. It is live and fully wired — 18 tables, row-level security on all of them, vector + keyword search functions, roles, plans/usage counters, classes and assignments. The spec will document it as built, so nothing has to be re-derived.

## Deliverables

1. `SPEC.md` at the project root — your template, fully filled in:
   - **1. Overview** — what Solution.AI is, the actual stack in use (React + TanStack Start, managed Postgres with pgvector, private file storage, AI gateway for chat/embeddings/OCR).
   - **2. Roles & permissions** — Student, Teacher, Super Admin, Guest, with the exact permission each role has, taken from the live access rules rather than guessed.
   - **3. Pages & screens** — public: landing, sign-in/sign-up (password, one-time code, Google), OAuth callback. Authenticated: Chat, Library, Classes, Study, Admin. Per page: purpose, key UI, empty/loading/error states.
   - **4. Core workflows** — signup and role assignment, teacher invite redemption, document upload → text extraction → OCR fallback → chunk → embed → index, ask-a-question with scoped retrieval and streaming citations, class create/join/share, assignment create and progress, study-tool generation, admin role and plan changes. Each as numbered steps with triggers.
   - **5. Features** — grouped exactly as in your template (auth, core, notifications, billing, search/filter, file handling, admin tools, other), marking each as built / partial / not built.
   - **6. Database schema** — every table with fields, types, constraints, defaults; every database function and trigger; relationship summary; access-rule summary in plain English; data rules (cascades, uniqueness, monthly usage periods).
   - **7. Integrations** — AI gateway models actually used, storage bucket, Google sign-in, and what an external rebuild must substitute.
   - **8. Design & UX** — the current dark navy/teal palette with token values, Space Grotesk typography, glass surfaces, sidebar + card layout, responsive behaviour.
   - **9. Known gaps** — the real remaining list (see below), separated into incomplete, bugs, planned-not-started, out of scope.
   - **10. Build instructions** — carried over, adjusted so a rebuild starts from the schema dump.

2. `SCHEMA.sql` at the project root — a single consolidated, ordered SQL file: extensions, enums, tables, grants, row-level security policies, functions, triggers, and seed rows for plan limits. Runnable top-to-bottom on a fresh Postgres so the "database was missing" problem cannot repeat.

3. A short chat summary of the gap list so you can correct it before it becomes the spec's Section 9.

## Known gaps the spec will record

Confirmed pending from the current build: the Study page exists but is not linked in the sidebar nav; chat citations show page numbers but have no page-anchored "open source page" action; the library uses a free-text subject field with no subject picker and no per-file upload queue/progress; the teacher assignments tables exist in the database but have no UI; there is no notification system of any kind; plans are tiers with enforced limits but no checkout or billing; parsing and OCR run in the browser, so closing the tab loses in-flight ingestion (50MB file cap, 60 OCR pages).

## Method

Read the eight applied migrations in order plus every route, server function and hook, then write the two documents from what the code and SQL actually say — no invented fields or endpoints. Anything genuinely ambiguous (for example, intended notification triggers, or whether Pro should ever bill) gets listed in a short "Open questions" section at the end of `SPEC.md` rather than silently decided.

## Out of scope

No changes to app code, database, or design in this task. The gap items are documented, not implemented.
