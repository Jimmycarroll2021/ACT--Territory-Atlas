# Kingston events access state

`public/events/kingston.json` is an access-required snapshot. Its empty `events` array means no feed is available to this application; it is **not** evidence that Kingston has no events. The official [VisitCanberra calendar](https://visitcanberra.com.au/events) is the current user path. Synthetic values appear only in `scripts/events/atdw.test.mjs` and are never published as live events.

The server-only module `server/events/atdw.mjs` holds an ATDW query-construction seam. It requires both `ATDW_DISTRIBUTOR_LICENSE_ACCEPTED=1` and a non-empty `ATDW_API_KEY`. Neither variable is set in this repository. The module makes no network request and writes no API response. Keep the key in a secret manager or local process environment, never in Git, build-time variables, public files, logs, or browser code. ATDW's query-string authentication means even a request URL is secret.

Before activating a feed, obtain the applicable distributor licence and credential, check the actual response shape and permitted redistribution, and implement ATDW-required attribution/tracking and expiry rules. A separate licensed server refresh and independent live verification are needed. Trial or synthetic results must not set public status to available. Do not commit raw licensed payloads; add an appropriate ignore rule before any future storage path is introduced.

Sources: [ATDW API search parameters](https://developer.atdw.com.au/ATDWO-search.html), [API key security](https://support.atdw.com.au/en/articles/44030-what-is-an-api-key), [distributor access](https://support.atdw.com.au/en/articles/43975-how-do-distributors-access-the-content).

Check with `node --test scripts/events/atdw.test.mjs`.
