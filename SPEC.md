# Solution.AI — Complete Specification

An AI-powered Retrieval-Augmented Generation (RAG) study platform. Users upload
their own study material, it is parsed (with OCR fallback for scans), chunked,
embedded and indexed; questions are then answered **only** from that material,
with inline citations back to the exact page.

This document describes the system as actually built and running, so it can be
rebuilt or ported elsewhere. The companion file `SCHEMA.sql` recreates the
entire database.

---

## 1. Stack

| Layer | What is used |
| --- | --- |
| Frontend | React 19 + TanStack Start (file-based routing, SSR), Vite 7 |
| Styling | Tailwind CSS v4 (tokens in `src/styles.css`), shadcn/ui, Recharts, sonner |
| Backend | TanStack `createServerFn` RPC + server routes under `src/routes/api/` (no separate API service) |
| Database | PostgreSQL with `pgvector` (3072-dim embeddings, HNSW over `halfvec`) + `tsvector` full-text search |
| Auth | Supabase Auth — email/password, email one-time code (OTP), Google OAuth |
| Storage | Private object bucket `documents`, access by signed URL only |
| AI | Lovable AI Gateway: `openai/gpt-5.6-sol` (chat + study tools), `google/gemini-embedding-2` (embeddings), `google/gemini-3.6-flash` (OCR) |
| Client parsing | `pdfjs-dist` (PDF text layer + page rasterisation), `mammoth` (DOCX) |

Deviation from the original brief: Next.js/FastAPI/Pinecone/S3 are replaced by
TanStack Start / Postgres+pgvector / Supabase Storage. Razorpay/Stripe billing
is **not** wired — plans exist as tiers with enforced limits, no checkout.

---

## 2. Roles and permissions

Roles live in a dedicated `user_roles` table (never on the profile), typed by
the `app_role` enum. A user can hold several roles.

| Role | Gets |
| --- | --- |
| **Student** | Upload/manage own documents, chat over own + class-shared material, join classes by code, study tools, own usage meter |
| **Teacher** | Everything a student has, plus create classes, share own indexed documents with a class, view per-student class activity, create assignments |
| **Super Admin** | Platform analytics, user table with role grant/revoke, plan switch (Free/Pro), teacher invite code management |

Rules that are enforced in the database, not the UI:

- Every new signup is forced to `student`. The role field chosen at signup is
  cosmetic; `handle_new_user()` ignores user metadata.
- `user_roles` is **read-only** to clients. Roles change only through
  `admin_set_role` (admin-gated) or `redeem_teacher_invite` (consumes a code).
- An admin cannot revoke their own admin role; the `student` role can't be removed.
- Every grant/revoke is written to `role_change_log`.

---

## 3. Pages

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | public | Landing page: product pitch, feature sections, sign-in CTA |
| `/auth` | public | Sign in / sign up. Password, one-time email code, or Google. Accepts `?redirect=<same-origin path>` |
| `/auth/callback` | public | OAuth/magic-link return point; waits for the session, then continues to the stored destination |
| `/chat` | signed in | RAG chat: streaming answers, citations, document scope picker, conversation history |
| `/library` | signed in | "My Documents": upload, indexing status, retry, open original, delete |
| `/study` | signed in | Study tools: generate quiz, flashcards or revision summary from one document |
| `/classes` | signed in | Students: join by code, redeem teacher invite. Teachers: create classes, share documents, see activity |
| `/admin` | admin only | Platform analytics + user management |

Everything signed-in lives under a `_authenticated` layout that renders the
sidebar (Chat, My Documents, Study, Classes, Admin when applicable) plus the
usage meter, and bounces signed-out visitors to `/auth?redirect=<path>`.

---

## 4. Core workflows

### 4.1 Sign in and deep-link redirect
1. A signed-out visitor hitting a protected path is sent to `/auth?redirect=/library`.
2. The target path is sanitised (same-origin path only, never another `/auth` URL) and stashed.
3. After password / OTP / Google succeeds, the app waits for the session to be persisted, then navigates to the stored path.
4. Google returns through `/auth/callback`, which polls for the session before continuing — so an OAuth round trip never lands on a still-unauthenticated protected route.

### 4.2 Ingestion (upload → searchable)
1. File chosen in `/library` (PDF, DOCX, TXT, or image; 50MB ceiling).
2. Parsed in the browser: PDF text layer via `pdfjs-dist`, DOCX via `mammoth`.
3. Pages with little or no extractable text are rasterised and sent to the OCR model in batches of 4, up to 60 pages, with live progress.
4. The original file is uploaded to the private `documents` bucket.
5. `consume_usage` checks the plan's document and page allowance before any AI spend.
6. Text is chunked at 1200 characters with 150 characters of overlap, split on sentence boundaries, page number retained per chunk.
7. Chunks are embedded in batches and inserted into `document_chunks`; the document flips to `ready` with page and chunk counts. Failures store `error_message` and can be retried from the library.

### 4.3 Asking a question
1. Optional scope: pick specific documents, otherwise the whole readable library.
2. `consume_usage('question')` enforces the monthly allowance.
3. The question is embedded, then `hybrid_match_document_chunks` retrieves the top passages — cosine similarity weighted 0.75, English full-text rank weighted 0.25 — restricted to documents the caller may read (own + class-shared).
4. Retrieved passages are assembled into a numbered context block and streamed through the chat model with a system prompt that forbids outside knowledge and requires inline `[n]` citations; it must say it cannot find the answer rather than guess.
5. Tokens stream to the client; on completion the assistant message is saved with structured citations (`documentId`, `fileName`, `page`, `snippet`, `score`).
6. Citations render as chips; opening one fetches a signed URL and jumps the PDF to that page.

### 4.4 Classes
1. A teacher creates a class; a 6-character join code is generated.
2. The teacher attaches their own indexed documents to the class.
3. A student enters the code; `join_class_by_code` adds membership without exposing the class table.
4. Shared documents immediately become searchable in that student's chat — retrieval authorisation flows from `can_read_document`.
5. The teacher sees per-student activity (documents, questions asked, last active) via `class_activity`.
6. Teachers post assignments (title, instructions, due date, attached documents); students track them as not started / in progress / done.

### 4.5 Study tools
Pick an indexed document and a mode. Up to 45 ordered chunks are sent to the
model, which returns a structured (schema-validated) set: multiple-choice quiz
with answers and explanations, flashcard deck, or a headed revision summary.
Every item carries the source page so it links back into the document. Counts
as one question against the monthly allowance.

### 4.6 Administration
`platform_stats` returns totals (users, teachers, students, documents, chunks,
questions, classes, failed documents), a 30-day daily series of questions and
uploads, and the top subjects — rendered as cards and Recharts charts.
`admin_list_users` lists every account with roles, plan, document and question
counts, signup and last sign-in; each row can toggle teacher/admin and switch
between Free and Pro. Admins also mint teacher invite codes with a use limit
and optional expiry.

---

## 5. Feature list

**Knowledge base** — multi-format upload (PDF/DOCX/TXT/images), AI OCR fallback
for scans, per-document status with error surfaced, retry re-indexing, subject
tagging, signed-URL access to the original, delete that removes the stored file
as well as the rows.

**RAG chat** — token-by-token streaming, hybrid vector + keyword retrieval,
grounded-only answering, page-anchored citations, document scope selection,
conversation history with rename and delete.

**Classes** — join codes, shared class knowledge bases, per-student activity,
assignments with progress tracking, teacher invite codes.

**Study tools** — quizzes, flashcards, revision summaries, all page-linked.

**Plans and usage** — Free (20 documents, 300 pages/month, 60 questions/month)
and Pro (500 / 10,000 / 3,000). Limits are checked and incremented atomically in
`consume_usage` before any AI call, so they cannot be bypassed from the client.
A sidebar meter shows current consumption. Admins move users between tiers.
No payment processing.

**Analytics** — platform dashboard for admins, class activity for teachers,
personal usage for everyone.

---

## 6. Database

Full DDL: `SCHEMA.sql`. Eighteen tables, all with row-level security.

| Group | Tables |
| --- | --- |
| Identity | `profiles`, `user_roles`, `role_change_log`, `teacher_invites` |
| Knowledge base | `documents`, `document_chunks`, `subjects` |
| Chat | `conversations`, `messages` |
| Classes | `classes`, `class_members`, `class_documents` |
| Assignments | `class_assignments`, `assignment_documents`, `assignment_progress` |
| Plans | `plan_limits`, `user_plans`, `usage_counters` |

Key functions: `has_role`, `can_read_document`, `can_read_assignment`,
`is_class_member`, `is_class_teacher`, `is_assignment_teacher`,
`join_class_by_code`, `redeem_teacher_invite`, `consume_usage`, `my_usage`,
`current_usage_period`, `match_document_chunks`,
`hybrid_match_document_chunks`, `admin_set_role`, `admin_set_plan`,
`admin_list_users`, `class_activity`, `platform_stats`, `handle_new_user`.

Security model, stated explicitly because it is easy to break when porting:

- RLS is the authorisation boundary. Ownership tables use `user_id = auth.uid()`; sharing is expressed through `can_read_document`.
- Access helpers are `SECURITY DEFINER` on purpose — they are called from RLS policies on the tables they read, which would otherwise recurse. Each one re-checks ownership or membership internally, and none are executable by anonymous callers.
- Privileged RPCs (`admin_*`, `platform_stats`) verify `has_role(auth.uid(), 'admin')` in their own body; the service-role key is never used for ordinary reads.
- Uploads are private; files reach the browser only through short-lived signed URLs.

---

## 7. Design system

Dark, glassy, teal-on-navy — deliberately not the default light SaaS look.
All values are semantic tokens in `src/styles.css`; components never hardcode
colours.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `oklch(0.19 0.032 235)` | deep navy canvas |
| `--foreground` | `oklch(0.96 0.012 210)` | near-white text |
| `--primary` | `oklch(0.82 0.13 186)` | teal — actions, active nav, focus rings |
| `--card` / `--surface` | `oklch(0.24 0.034 234)` (+ 70% translucent variant) | panels |
| `--muted-foreground` | `oklch(0.72 0.026 220)` | secondary text |
| `--destructive` | `oklch(0.63 0.2 22)` | destructive actions |
| `--gradient-accent` | `linear-gradient(135deg, oklch(0.86 0.13 178), oklch(0.72 0.12 232))` | hero text, primary buttons, badges |
| `--gradient-hero` | two radial teal/blue washes from top-left and top-right | landing and shell background |
| `--shadow-glow` | teal ring + soft outer glow | emphasised cards |
| `--radius` | `0.875rem` | base corner radius |

Typography: **Space Grotesk** for display and headings (`--font-display`),
system sans for body. Charts use the `--chart-1..5` teal→blue→green→amber→violet
ramp. A `glass` utility supplies the translucent, blurred, hairline-bordered
panel treatment used across the shell.

Layout: fixed sidebar + fluid content on desktop, collapsing to a stacked
mobile layout. Feedback is always a toast; destructive actions confirm first.

---

## 8. Environment

Client (`import.meta.env`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
Server (`process.env`, read inside handlers): `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`.

Auth setup: email/password and email OTP enabled; Google OAuth enabled; no
anonymous sign-ups; email confirmation on.

---

## 9. Known gaps / next up

1. **Library upload queue** — uploads are still processed one at a time from the browser; a multi-file queue with per-file progress and cancel is not built. Closing the tab mid-parse loses that file's progress.
2. **Subject picker** — the `subjects` table exists but the library still takes subject as free text instead of a managed dropdown.
3. **Assignments UI** — tables, policies and progress tracking exist; the teacher-facing create/assign screen and the student assignment list are not built yet.
4. **Reranking** — retrieval is hybrid but has no cross-encoder rerank step over the merged candidate set.
5. **Inline citation preview** — citations open the original at the right page; there is no in-app side-by-side passage viewer.
6. **Billing** — plans are enforced tiers only; no checkout, invoices or upgrade flow.
7. **OCR ceiling** — 60 pages per document; longer scanned books are truncated.
