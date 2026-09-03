# Solution.AI roadmap

## Done
- [x] Export `SCHEMA.sql` as a PDF appendix (`Solution-AI-Schema.pdf`)
- [x] Study page linked in the sidebar nav
- [x] Chat citations open the source document at the cited page
- [x] Library multi-file upload queue with per-file progress + cancel
- [x] Subject picker (managed subjects list instead of free text)

## In progress / next
- [ ] Teacher assignments UI (create, attach documents, student progress) surfaced for teachers + admin panel
- [ ] Pricing page: Free/Pro tiers, coupon field, checkout button wired to payments
- [ ] Admin branding panel: app name, logo, theme colours, favicon — applied site-wide
- [ ] Confirm/close out RAG backend question (pipeline is already real: Lovable AI Gateway
      chat + embeddings, pgvector hybrid retrieval — nothing mocked)

## Notes
- Built-in payments require a paid workspace plan; if unavailable the pricing page ships with
  the tiers/coupon UI and a checkout button that reports payments are not yet enabled.
