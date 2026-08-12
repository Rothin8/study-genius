# Solution.AI — what's left, what's weak, and what to build next

## Where the app stands now
Uploads with OCR fallback, chunked + embedded indexing, streaming cited answers with hybrid (meaning + keyword) search, document scoping, chat history rename/delete, open-original links, retry re-indexing, roles locked down with an admin user-management screen and teacher invite codes, classes with join codes and shared material, and an admin analytics dashboard.

## Problems still present (verified in code)
1. **No plans or limits.** There is no plan or usage table anywhere, so a single account can upload unlimited files and ask unlimited questions. The subscription tiers from the original brief simply don't exist yet.
2. **Uploads are capped and fragile.** Files must be under 20MB, only the first 10 scanned pages get OCR, parsing happens in the browser one file at a time, and closing the tab mid-upload loses the work with no visible per-file progress.
3. **Citations don't take you to the page.** You can open the original file, but not at the cited page, and the citation snippet isn't previewable inline.
4. **Subject is free text.** Typos create duplicate "subjects", which weakens filtering and makes analytics noisy.
5. **Teacher tooling is thin.** Classes share documents and show activity, but there is no assigned reading, no per-student question view, and no bulk add/remove of shared documents.
6. **No study tools.** No quizzes, flashcards, or chapter summaries generated from the indexed material — the app only answers questions.
7. **Answers end flat.** No follow-up suggestions, no regenerate, and no way to copy or export an answer with its sources.

## Plan to fix

**Phase 4 — Plans and usage limits (no billing)**
- Add a plan per user (free / pro) plus a monthly usage counter for documents, pages and questions.
- Enforce limits server-side inside upload and ask, so the browser cannot bypass them.
- Show a usage meter in the sidebar and a clear message when a limit is hit; admins can change a user's plan from the existing admin screen.

**Phase 5 — Library reliability at scale**
- Queue multiple uploads with per-file progress and resume-safe status, so a closed tab doesn't lose indexed work.
- Raise the OCR page ceiling with batched progress instead of a hard 10-page cut.
- Open the original at the cited page, and show the cited snippet inline in chat before opening the file.
- Replace free-text subject with a managed subject list (pick or create once, reuse everywhere).

**Phase 6 — Teacher workspace**
- Assigned reading per class: teacher picks documents and optional questions, students see progress.
- Per-student view: questions asked, documents read, last active.
- Bulk share/unshare of class documents.

**Phase 7 — Study tools**
- Generate quizzes and flashcards from a chosen document or subject, every answer cited back to a page.
- On-demand chapter summary / outline per document.
- Follow-up question suggestions, regenerate, and copy answer with sources.

## Technical notes
- Plans/usage: two small tables (plan per user, monthly usage rows), owner-read only, writes from server functions; limit checks inside the ingest and chat-stream handlers before any AI call.
- Upload queue stays client-side for parsing but writes document rows first, so a partially indexed file resumes via the existing retry path.
- Page-anchored preview appends a page fragment to the signed URL for PDFs and falls back to plain open for other types.
- Subjects become their own table referenced by documents; existing free-text values migrate into it.
- Assignments need a class_assignments table plus a per-student progress table, both guarded by the existing class teacher/member helper functions.
- Quiz/flashcard/summary generation reuses the current retrieval path and returns structured JSON validated with Zod before rendering.
