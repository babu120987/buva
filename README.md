BUVA — MODERN FINE FRAGRANCE

Buva is a responsive multi-page fragrance brand website built with semantic HTML,
CSS and lightweight JavaScript. The site includes the home page, brand story,
fragrance collection, catalogue-backed product detail pages, journal, contact
and custom 404 page. The journal newsletter stores normalized, unique email
subscriptions in PostgreSQL. Shopping answers from the assistant use the live
catalogue for prices, availability and product descriptions.

Local preview with Docker Compose:
  docker compose up --build

Then visit:
  http://localhost:8080

SEO audit and sitemap sync
--------------------------

Run `node scripts/seo-audit.mjs` to check local page titles, descriptions,
canonicals, Organization/WebSite data, robots.txt, and sitemap URLs. Run
`node scripts/seo-audit.mjs --live` to compare the local sitemap with the
public product catalog at buva.shop. Run
`node scripts/seo-audit.mjs --sync-sitemap` to rebuild the local sitemap from
that catalog before a release. The sync changes only `frontend/sitemap.xml`;
it does not deploy or submit anything to Google.

Database migration
------------------

Before running this version of the backend, apply the idempotent migration in
`backend/migrations/001_storefront_features.sql` through
`backend/migrations/006_newsletter.sql` to the BUVA PostgreSQL
database. For example:

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/001_storefront_features.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/002_invoices.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/003_product_views.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/004_support_replies.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/005_guest_invoices.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/006_newsletter.sql

This repository does not apply migrations or deploy itself automatically.

Optional backend configuration:

- `PUBLIC_SITE_URL` controls the Google sign-in return URL and defaults to
  `https://buva.shop`.
- When deploying the domain migration, set the production backend's
  `PUBLIC_SITE_URL` to `https://buva.shop` and update the Google OAuth callback
  configuration for the domain. Keep the old host redirecting to the matching
  `https://buva.shop` path so indexed links retain their destinations.
- `RAG_API_URL` points to the BUVA RAG service. When it is unavailable, the
  shopping assistant falls back to live catalogue recommendations.
- `FIREBASE_PROJECT_ID` defaults to `buva-90d4b`. Browser order alerts also
  require `FIREBASE_SERVICE_ACCOUNT_JSON` containing a Firebase service account
  with Firebase Cloud Messaging send permission. The Kubernetes deployment
  reads it from the optional `buva-firebase/service-account.json` secret.
  Keep the JSON private and never commit it. Order status emails use the
  existing `GMAIL_USER` and `GMAIL_APP_PASSWORD` settings.

Integration test
----------------

With a disposable migrated database and the frontend/backend running, execute:

  BUVA_TEST_URL=http://127.0.0.1:18080 \
  BUVA_TEST_ADMIN_KEY=your-test-admin-key \
  node tests/integration.mjs

The test creates uniquely named test records and covers search, banners,
accounts, addresses, wishlist, notifications, support, coupons, checkout,
tracking, reviews, product history, recommendations, the assistant, and CSV
and Excel exports.

Payment and fulfilment are separate: a captured Razorpay payment changes
`payment_status` to `paid`, while the order stays `pending` until an admin
confirms it. `tests/payment-pending.mjs` checks both payment verification and
the webhook against a local mock Razorpay server and disposable database.
