# BUVA web ecommerce feature audit

Scope: `/home/babu/Git/buva_perfume` web storefront and Node/PostgreSQL API.
Android and iOS were excluded. No deployment or DNS operation was performed.

## Initial inspection

| Area | Initial state | Evidence / gap found |
| --- | --- | --- |
| Customer profile/address | PARTIAL | Account read and address creation existed; profile edit and address edit/delete UI/API were missing. |
| Search/filter | PARTIAL | Scent-family chips existed; no text search, sorting, price query support, or search metadata. |
| Admin banners/export | MISSING | No banner schema/API/UI and no downloadable business export. |
| Courier tracking | MISSING | Orders had statuses but no courier, tracking number, URL, or customer tracking display. |
| Wishlist | MISSING | No persistence, API, or storefront controls. |
| Coupons | PARTIAL | Checkout redemption existed; management and pre-validation endpoints/UI were missing. |
| Ratings/reviews | PARTIAL | Verified-purchase submission had been started; customer UI, aggregates, public reads, and moderation were missing. |
| Notifications/support | BROKEN | Firebase token code only logged tokens; the contact form never submitted data. |
| AI shopping assistant | PARTIAL | A home-only widget called a hard-coded private RAG proxy with no resilient fallback. |
| SEO / buva.shop migration | BROKEN | The home `<head>` started with stray markup and no stylesheet, while canonical, robots, sitemap, OAuth return, and ingress host referenced DuckDNS. |

## Implemented state

| Area | State | Implementation |
| --- | --- | --- |
| Customer profile/address | COMPLETE | Authenticated profile update plus address add/edit/delete/default controls and checkout reuse. |
| Search/filter | COMPLETE | API text/family/price/sort filters and storefront text search, scent filtering, and price sorting. |
| Admin banners/export | COMPLETE | Scheduled home/shop banners, admin create/enable controls, storefront rendering, and protected CSV order export. |
| Courier tracking | COMPLETE | Courier fields, admin tracking editor, status timestamps, and customer tracking link. |
| Wishlist | COMPLETE | Authenticated database wishlist, product-card toggles, and account management. |
| Coupons | COMPLETE | Existing checkout redemption plus validation API and admin create/enable controls. |
| Ratings/reviews | COMPLETE | Delivered-order review UI, rating aggregates, approved review reads, and admin moderation. |
| Notifications/support | COMPLETE | Persisted preferences and web tokens, working support ticket submission, acknowledgement email, and admin resolution queue. |
| AI shopping assistant | COMPLETE | All-page assistant using configurable RAG with a live-catalogue recommendation fallback. |
| SEO / buva.shop migration | COMPLETE | Fixed document head, canonical/OG/JSON-LD, robots/sitemap, configurable OAuth return, and buva.shop ingress manifest. |

Database-backed additions require the checked-in migration to be applied by an
operator. That operation was intentionally not run as part of this work.

## 2026-09-26 web follow-up

Android and iOS remain outside scope. The following web additions were deployed
as `20260926-web-features-v2` after applying migrations 003 and 004:

- Catalog minimum/maximum price controls; admin Excel order export.
- Product details, signed-in recently viewed history, and recommendations based
  on browsing, wishlist and order scent families.
- Order status email notifications and a Firebase Cloud Messaging send path;
  browser tokens are removed on explicit sign-out.
- Customer support ticket history and new requests, plus admin replies and
  reply emails; banner editing and scheduling controls.

The isolated integration suite passed. Both production deployments reached
2/2 ready; the homepage, product API and sitemap return 200. The old DuckDNS
host still returns a 301 to the matching buva.shop path.

External setup remains:

- Courier API booking, label generation and automatic tracking require a chosen
  courier platform and its account credentials. Manual tracking is live.
- Browser push delivery requires the `buva-firebase/service-account.json`
  Kubernetes secret. It was added on 2026-09-26 and backend authentication to
  Firebase succeeded. No customer devices are registered yet, so live delivery
  still needs an opt-in device test.
- Email code is live and production Gmail credentials are referenced by the
  deployment; actual inbox delivery has not been verified with a real order.

Recovery backup: `/home/babu/buva-dr-backup/2026-09-26/web-features-v2/buva-production.dump`.

## 2026-09-26 order confirmation correction

Razorpay verification and the capture webhook previously changed fulfilment
status from `pending` to `confirmed` automatically. Both paths now update only
payment status to `paid`; admins confirm orders separately. The backend image
`20260926-manual-order-confirm-v1` was deployed, and a mock Razorpay regression
test passed for verification, webhook capture, and manual admin confirmation.

The two recent unshipped orders auto-confirmed by the old code were restored to
`pending` with payment still `paid`:
`BUVA-20260926-312B2859` and `BUVA-20260925-F4378363`. The admin Pending API
returned both orders afterward. Pre-fix backup:
`/home/babu/buva-dr-backup/2026-09-26/manual-order-confirm-v1/buva-production.dump`.

## 2026-09-26 Firebase activation

The `buva-firebase` Kubernetes Secret was installed from the Firebase project
`buva-90d4b` service-account JSON. The backend rolled out to 2/2 ready. It
successfully obtained a Firebase Messaging access token and reached FCM's
validation-only endpoint; FCM rejected the deliberately fake device token as
invalid. The production `notification_devices` table has zero rows, so a real
browser notification has not been delivered yet. The credential is preserved
in an encrypted local recovery file beside the full 2026-09-26 backup; its
plaintext Linux copy was removed.
