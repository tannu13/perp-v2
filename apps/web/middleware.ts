import { NextResponse, type NextRequest } from "next/server";

/**
 * Route protection is CLIENT-side now, not here.
 *
 * The session cookie belongs to the API host (`api.example.com`), not to this
 * app's origin — that is what makes it host-only and immune to a sibling
 * subdomain. The consequence is that neither middleware nor a Server Component
 * can see it: they run on a different host and the browser never sends it here.
 *
 * So the guard lives in `RequireSession`, which renders a skeleton until the
 * session probe answers and redirects if it comes back anonymous. The trade-off
 * is honest: a protected route now paints one loading frame before redirecting,
 * where middleware could redirect before any HTML was sent. Nothing is exposed
 * by that frame — it renders no account data, because there is none to render
 * until `GET /me` succeeds.
 *
 * The alternative — having the frontend also set a readable "signed in" hint
 * cookie on its own origin purely so middleware could redirect earlier — was
 * rejected: it is a second source of truth about auth state that can disagree
 * with the real one, in exchange for saving one frame.
 *
 * This file is kept as the place that decision is written down.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = { matcher: [] };
