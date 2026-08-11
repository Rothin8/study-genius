# Solution.AI — gaps today and what to build next

## What already works
Uploads (PDF/DOCX/images/text) with OCR fallback, chunking + embeddings, cited chat answers, student/teacher roles, classes with join codes and shared documents, admin analytics dashboard, and deep-link redirect after sign-in.

## Problems in the current setup (verified in code/database)

1. **Anyone can sign up as a teacher.** The signup form sends the chosen role as user metadata and the database trigger trusts it, so a student can pick "Teacher" and start creating classes.
2. **Nobody can become an admin, and roles can never change.** The roles table allows reads only — there is no insert/update path and no admin UI, so the Analytics page is unreachable for real users and a mistyped role is permanent.
3. **Answers arrive in one silent block.** Chat waits for the full model response before showing anything, so a long answer looks frozen for 10–30 seconds.
4. **You cannot choose what the AI reads.** Retrieval supports narrowing to specific documents, but chat never uses it — every question searches the whole library plus all class material, which dilutes answers when subjects overlap.
5. **Retrieval is vector-only with a fixed cutoff.** Exact terms (formula names, section numbers, codes) can be missed, and a 0.25 similarity floor with 8 chunks is applied to every question type.
6. **Deleting a document leaves the original file behind.** Rows are removed but the stored file stays, so storage grows forever and the file is still uploaded after "delete".
7. **Uploaded originals are never viewable.** Citations name a file and page, but you cannot open the source page to check it.
8. **Failed uploads are dead ends.** A document that fails processing shows an error with no retry or re-index action.
9. **Ingestion is client-side and fragile.** Files are parsed in the browser one at a time, capped at 20MB, with OCR limited to the first 10 scanned pages; closing the tab mid-upload loses the work.
10. **No conversation management.** Chats cannot be renamed or deleted, and the picker only shows the last 12.
11. **Plan tiers were agreed but never built.** There is no plan or usage table, so nothing limits uploads, pages or questions per user.
12. **Teacher tooling is thin.** Classes share documents and show activity, but there is no assigned reading, no per-student question view, and no bulk management of shared documents.

## Suggested new features (beyond fixes)
- **Quiz & flashcard generation** from a selected document or subject, with answers cited back to pages.
- **Study summaries / chapter outlines** generated per document on demand.
- **Subject picker instead of free-text subject** so filtering and analytics stay clean.
- **Streaming answers with follow-up suggestions** and a "regenerate" action.
- **Class assignments**: teacher sets reading + questions, student progress shows in class activity.
- **Usage meter** in the sidebar showing plan limits consumed this month.

## Proposed fix plan (ordered)

**Phase 1 — Trust and access (must-do)**
- Stop trusting the signup role: everyone starts as a student; teacher status is granted by an admin (or an invite code) rather than self-selected.
- Add an admin user-management screen: list users with roles, grant/revoke teacher and admin, backed by an admin-only server function with database-side role checks.
- Seed the first admin through a migration.

**Phase 2 — Chat quality**
- Stream the answer token by token, then persist the final message and citations.
- Add a document/subject scope selector in chat that passes the chosen document IDs to retrieval.
- Hybrid retrieval: combine vector search with keyword matching, widen the candidate pool, rank before sending context.
- Conversation rename, delete, and a full history list.

**Phase 3 — Library reliability**
- Delete the stored original whenever a document is removed.
- Retry / re-index action for failed documents.
- Signed-URL preview of the original file, opened from a citation at the right page.
- Raise OCR page coverage with batched progress and visible partial progress.

**Phase 4 — Plans and limits**
- Plan tier per user (free/pro) plus a monthly usage counter enforced server-side on upload, OCR and question, with a usage meter in the UI. No billing.

**Phase 5 — Teacher and study tools**
- Class assignments and per-student question insights.
- Quiz/flashcard and summary generation from selected sources.

## Technical notes
- Role changes need insert/update policies on the roles table restricted to admins via the existing `has_role` security-definer function, plus an admin-only server function; the signup trigger stops reading `role` from user metadata.
- Streaming means switching `askQuestion` to a streamed response with the message row written on completion; citations come from the chunks already retrieved before generation.
- Scoped retrieval reuses `match_document_chunks`'s existing `filter_document_ids` argument — no schema change.
- Hybrid search adds a Postgres full-text index on chunk content plus a combined ranking function.
- Storage cleanup runs in a server function (delete object, then row) so the client cannot skip it.
- Plans/usage need two small tables with owner-read and server-side writes, and limit checks inside the ingest/ask handlers.