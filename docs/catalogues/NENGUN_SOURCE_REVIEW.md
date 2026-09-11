# Nengun source review

Reviewed: 2026-09-10. Updated: 2026-09-12 with a confirmed robots.txt read.

## 2026-09-12 robots.txt confirmation

robots.txt was successfully retrieved on this date (the 2026-09-10 attempt failed with an internal retrieval error; its directives were unverified until now). Findings:

- `User-agent: ClaudeBot` is disallowed for the entire site. No Claude-attributed automated agent should fetch any nengun.com page, not only the catalogue paths below.
- `User-agent: *` (all other bots) is disallowed from `/auction/`, `/oem/group/`, `/oem/variant/`, `/oem/parts/`, `/catalogue/vehicle/`, `/vehicle/widget/`, `/user/`, `/order/`, `/cart/`, and `/cdn-cgi/`.
- No `Allow`, `Crawl-delay`, or `Sitemap` directives are present.
- An example catalogue URL supplied for architecture-analysis purposes (`/oem/parts/317568/...`) falls under both the `/oem/parts/` disallow rule and the ClaudeBot site-wide ban. It was not fetched, and no other page was fetched in that session.

This is a confirmed, definitive result superseding the 2026-09-10 note below: automated access to the OEM catalogue hierarchy is explicitly disallowed by the site's own robots directives, independent of the terms-and-conditions review. No crawler is enabled and no CAPTCHA, authentication, anti-bot, robots.txt, or rate-limit bypass is attempted or planned. `docs/catalogues/NENGUN_FIELD_MAP.md` (built the same day) therefore documents structure as _described by the application owner_, not as independently re-verified against the live site.

## 2026-09-10 original review

Public structure: OEM landing page → manufacturer → vehicle/model/variant → sections → diagram → callout rows → orderable OEM numbers. A callout may identify several rows across production periods. Diagram codes are not orderable OEM identifiers. Potential fields include source row ID, number, description, quantity, production range, specification, replacement reference, quote status and quoted currency.

Sources:

- https://www.nengun.com/oem
- https://www.nengun.com/info/terms-and-conditions
- https://www.nengun.com/enquiry
- https://www.nengun.com/robots.txt

The terms reserve copying and republication to prior written permission and limit stated site-content use to shopping/ordering. No permission or licensed feed has been supplied. No official public bulk API/feed documentation was identified in the reviewed pages/search; this is not proof none exists. The enquiry page is the contact route; no enquiry was sent.

robots.txt could not be retrieved by the research tool on this date (internal retrieval error); see the 2026-09-12 update above for the confirmed result.

Image display/redistribution rights are unconfirmed. The legacy copied headlamp image is removed from served assets; the source link and dated existing business references remain. New development uses an original conceptual drawing. This review is an engineering enablement decision, not legal advice.

Required before enabling: written permitted usage scope, data/image display and redistribution terms, authorized API/feed or collection method, robots/access review, rate limits, caching/retention and attribution rules. Until then the WebReferenceProvider only stores links/metadata and rejects extraction.

## What would unblock authorized import

1. Written permission or a licensed feed/API contract from Nengun (or an authorized reseller) covering: data extraction scope, image display/redistribution rights, rate limits, caching/retention, and attribution requirements.
2. If permission is granted, an actual transport implementation (an authenticated HTTP client or supplied feed reader) — `src/integrations/catalogues/nengun/provider.ts` deliberately contains no fetch/HTTP call and must not gain one until step 1 is satisfied.
3. `NENGUN_IMPORT_MODE=licensed_import` set only once steps 1–2 are in place — see `src/integrations/catalogues/nengun/config.ts`. Setting the variable alone does not enable extraction; the provider still raises a "no authorized transport" error until step 2 exists.
