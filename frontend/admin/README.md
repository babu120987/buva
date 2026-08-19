# Buva admin

The protected administration interface is served at
`http://localhost:8080/admin/`. It communicates only with the backend API and
never accesses PostgreSQL directly.

Set `ADMIN_API_KEY` in `.env`, then use that value to unlock the dashboard. The
Docker Compose local fallback is `buva_admin_local`; replace it outside local
development.

Current capabilities:

- order summary metrics, status filters and customer/order search
- full order, delivery, payment and line-item detail
- controlled fulfilment transitions from pending through delivered
- cancellation and return handling with transactional inventory restoration
- catalogue metrics, active/archived and low-stock filters, and product search
- product creation and editing for merchandising, pricing, imagery and stock
- guarded inventory updates that cannot undercut currently reserved units
