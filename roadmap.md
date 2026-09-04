# Solution.AI roadmap

## Done
- Study page linked in sidebar
- Chat citations open the source document at the cited page
- Library multi-file upload queue + managed subject picker
- Schema + full plan PDFs exported
- Teacher assignments: create/delete, attach documents, progress counts (Classes → Manage → Assignments)
- Student assignments list with not started / in progress / done tracking
- Admin assignments report across all classes (`admin_list_assignments`)
- Admin branding panel (name, tagline, logo, favicon, primary/background/accent colours) applied site-wide
- Public pricing page with Free/Pro tiers, monthly/yearly toggle, coupon field, checkout button
- RAG backend is real (Lovable AI Gateway, `openai/gpt-5.6-sol` + embeddings) — no mock to replace

## Open
- Real card checkout: needs payments enabled on the workspace (paid plan). Until then admins grant Pro from Analytics → Users.
- Logo/favicon are URL-based; public asset uploads are blocked on this backend.
- Authenticated end-to-end browser verification pending an available sign-in session.
