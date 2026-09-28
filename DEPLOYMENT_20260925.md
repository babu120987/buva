# BUVA storefront production deployment — 2026-09-25

## Deployed

- Namespace: `buva`
- Backend revision: `34`
- Backend image: `localhost:5000/buva-backend:20260925-invoice-account-fix-v2`
- Backend digest: `sha256:1f8a5797b670c28f457df84c9a5f063d292c9aa454751759454f96a7a3a75616`
- Frontend revision: `36`
- Frontend image: `localhost:5000/buva-frontend:20260925-invoice-account-fix-v2`
- Frontend digest: `sha256:6fdc633b0501105e8965de7eea75df180d321e96686f9c3e68d2fd87c1c9081f`
- Backend replicas: 2/2 ready
- Frontend replicas: 2/2 ready
- Existing ingress retained: `bhuva.duckdns.org`
- Temporary backend override: `PUBLIC_SITE_URL=https://bhuva.duckdns.org`

The production database migrations in `backend/migrations/001_storefront_features.sql`
and `backend/migrations/002_invoices.sql` were applied successfully.

The second rollout restores authenticated invoice list/detail APIs, printable
invoice pages, invoice links on account orders, and transactional invoice
creation for new signed-in orders. Existing customer-linked orders retained
their invoices; no guest orders were automatically assigned to accounts.

## Recovery artifacts

- `/home/babu/buva-dr-backup/2026-09-25/predeploy-storefront-v1/buva-production.dump`
- `/home/babu/buva-dr-backup/2026-09-25/predeploy-storefront-v1/buva-backend-deployment.yaml`
- `/home/babu/buva-dr-backup/2026-09-25/predeploy-storefront-v1/buva-frontend-deployment.yaml`
- `/home/babu/buva-dr-backup/2026-09-25/predeploy-storefront-v1/buva-frontend-ingress.yaml`
- `/home/babu/buva-dr-backup/2026-09-25/predeploy-invoice-account-fix-v2/buva-production.dump`
- `/home/babu/buva-dr-backup/2026-09-25/predeploy-invoice-account-fix-v2/buva-backend-deployment.yaml`
- `/home/babu/buva-dr-backup/2026-09-25/predeploy-invoice-account-fix-v2/buva-frontend-deployment.yaml`
- `/home/babu/buva-dr-backup/2026-09-25/predeploy-invoice-account-fix-v2/buva-ingress.yaml`

## Verification

- Database migration objects verified.
- Backend and frontend rolling updates completed successfully.
- Only the new ReplicaSets are ready service endpoints.
- Public home, admin, product search, assistant and rating fields verified.
- Headless Chromium storefront/search/assistant/admin smoke test passed with no
  page errors.
- Backend dependency audit: zero known vulnerabilities.
- Isolated PostgreSQL restore and idempotent invoice migration passed.
- Integration suite verified orders, invoice creation/list/detail, and all
  existing storefront feature flows.
- Invoice authorization verified: unauthenticated requests return `401` and
  cross-account invoice requests return `404`.
- Production authenticated smoke test returned `200` for account, invoice list,
  and invoice detail; all 14 sampled account orders had invoice numbers.

## Rollback

The schema migration is additive and can remain in place when rolling the
application images back.

```bash
kubectl -n buva set image deployment/buva-backend \
  backend=localhost:5000/buva-backend:20260925-storefront-features-v1
kubectl -n buva rollout status deployment/buva-backend --timeout=120s

kubectl -n buva set image deployment/buva-frontend \
  frontend=localhost:5000/buva-frontend:20260925-storefront-features-v1
kubectl -n buva rollout status deployment/buva-frontend --timeout=120s
```

## Pending domain action

`buva.shop` did not resolve at deployment time. DNS and TLS were not changed.
After the domain resolves to the ingress and its TLS certificate is ready:

1. update the ingress host/TLS configuration;
2. update the Google OAuth callback configuration;
3. set `PUBLIC_SITE_URL=https://buva.shop`;
4. verify canonical URLs, OAuth and checkout on `https://buva.shop`.
