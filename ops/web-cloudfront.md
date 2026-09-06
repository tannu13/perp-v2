# Frontend deploy — S3 + CloudFront

`apps/web` builds to a directory of static files (`output: "export"` in
`next.config.ts`). There is no web container and no `web` Deployment in `k8s/`;
the frontend is the one part of this stack that does not run in the cluster.

It is served at `web.perps.tanujpant.com`, a sibling of the two hostnames
`k8s/05-ingress.yaml` routes. Whatever hostname CloudFront ends up on must also
appear in backend's `CORS_ORIGINS` (`k8s/02-backend.yaml`), or every request
from it is rejected before it reaches a controller.

## Build

The two public URLs are **inlined into the JS bundle at build time**, so they
are build inputs, not runtime config. A given `out/` is bound to one
environment — there is no promoting the same artifact from staging to prod.

```bash
cd apps/web
NEXT_PUBLIC_API_URL=https://api.perps.tanujpant.com \
NEXT_PUBLIC_WS_URL=wss://ws.perps.tanujpant.com \
bun run build          # → apps/web/out
```

## Upload

Two passes, because the two halves want opposite cache headers. Everything
under `_next/` is content-hashed and safe to cache forever; the HTML must not
be, or a deploy is invisible until the TTL expires.

```bash
B=your-bucket
aws s3 sync out/_next "s3://$B/_next" --delete \
  --cache-control "public,max-age=31536000,immutable"
aws s3 sync out "s3://$B" --delete --exclude "_next/*" \
  --cache-control "public,max-age=0,must-revalidate"
aws cloudfront create-invalidation --distribution-id "$D" --paths "/*"
```

## The URL rewrite

The export writes `out/trade/BTC-USD.html`, but the app links to
`/trade/BTC-USD`. S3 does no extension guessing, so without this the whole app
404s. Attach as a **viewer-request CloudFront Function** on the default
behaviour:

```js
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === "/") {
    request.uri = "/index.html";
  } else if (uri.endsWith("/")) {
    request.uri = uri.slice(0, -1) + ".html";
  } else if (!uri.split("/").pop().includes(".")) {
    // Extensionless, so it is a route. Anything with a dot is already a file:
    // /_next/static/chunks/*.js must pass through untouched.
    request.uri = uri + ".html";
  }
  return request;
}
```

## The 404

An unknown market slug (`/trade/DOGE-USD`) no longer reaches `notFound()` —
`dynamicParams = false`, so only the three built pages exist. CloudFront answers
instead, and needs mapping back to the build's own 404 page:

| Error code | Response page | Response code |
| ---------- | ------------- | ------------- |
| 403        | `/404.html`   | 404           |
| 404        | `/404.html`   | 404           |

**403 matters as much as 404.** With Origin Access Control and a private
bucket, S3 returns `AccessDenied` — not `NoSuchKey` — for a missing object
unless the bucket policy also grants `s3:ListBucket`. Map only 404 and every
bad URL becomes a bare CloudFront 403.

## Optional: one origin for everything

Adding `/api/*` and `/ws` behaviours on this same distribution, pointed at the
ALB in front of `backend-service` and `ws-server-service`, would make the
frontend's own host the only origin — `NEXT_PUBLIC_API_URL` becomes a path.

It buys less than it looks like. The cookie is *already* fine across
subdomains of one registrable domain: `SameSite` is computed on eTLD+1, so
`web.perps.example.com` → `api.perps.example.com` is cross-origin but
same-site, and the `Lax` cookie rides along (see
`apps/backend/src/utils/session-cookie.ts`). What one origin actually removes
is CORS and its preflights. Weigh that against WebSockets through CloudFront
billing by the hour.
