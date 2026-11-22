# Kingston five-layer handover

Status: integrated command checks and independent exact-candidate review passed on 22 November 2026. The fresh-laptop verification is pending. Check `git rev-parse HEAD` and the GitHub `main` ref for the delivered commit. No public deployment is part of this handover.

## Candidate and ownership

- Repository: `https://github.com/Jimmycarroll2021/ACT--Territory-Atlas.git`
- Base commit: `23db940bc5dd87cd72cca0d1d309ff83b9ef59f2` (`main`). Resolve the final five-layer commit from the repository rather than treating the base as the delivered revision.
- Project root: `C:\Users\Jimmy\Projects\canberra-property-map`
- Public output: `dist/` from `npm.cmd run build`; the repository's source and public snapshots are the laptop transfer unit.
- Do not stage `scripts/hazards/__pycache__/`, local virtual environments, credentials or any private property data. Preserve existing backup and source records.

## Delivered scope and limits

1. DA Finder: reviewed proposal summaries and decision evidence for exact-number matches in the pinned planning inventory. The detail check found 71 DAs: 47 matched, 15 ambiguous, 8 unavailable and 1 unreviewed. Missing or changed evidence suppresses the optional summary.
2. Hazard screening: static ACTmapi flood and bushfire polygon intersections for 375 registered Kingston blocks. It is a block-level map screen, not a home risk, insurance or emergency assessment. Published hazard JSON SHA-256 checked as `818d0f9a70c38465b752dd21300219622184ab9b38b187dde07b03b2e1c0860e`.
3. Daily-life amenities: 612 mapped records and nearest-category references for 4,660 official address IDs. Distances are approximate straight lines to mapped points or geometry centres. OSM listings are incomplete. Published amenity JSON SHA-256 checked as `187644bb48dc537053fe65235fa1949e7cc6d48317d5e19623913165ddb12cc4`.
4. Commute: a local, loopback-only API validates address or coordinate trips and zoned departure. Journey time and itinerary remain unavailable without a routing engine and approved timetable feed. Saved Roads ACT point notices can be queried for a selected 24-hour window; route impact stays unknown.
5. Events: the public snapshot reports access required and offers the official VisitCanberra calendar. No licensed ATDW key, live feed or event claims are published.

The static build cannot provide the local commute or optional private-property API without the Node server or an equivalent authorised backend. There is no public release. See `README.md` and the per-layer `data/*/README.md` or method files for source, licence, refresh and interpretation details.

## Integrated command receipts

All commands ran from the project root on 22 November 2026 against the uncommitted five-layer worktree. The checks establish local build and data/test consistency, not browser behaviour on another laptop or live source currency.

| Check | Result |
| --- | --- |
| `npm.cmd run build` | Passed: TypeScript and Vite; Vite reported a nonblocking large-chunk warning. |
| `python -B scripts/planning/da_details.py --check` and `python -B scripts/planning/da_details.test.py` | Passed; exact output replay and 8 tests. |
| `uv run --python 3.12 scripts/hazards/refresh.py --check` and `uv run --python 3.12 scripts/hazards/test_refresh.py` | Passed; 375 blocks and 3 tests. |
| `node scripts/amenities/refresh.mjs --check` and `node --test scripts/amenities/refresh.test.mjs` | Passed; 612 facilities, 4,660 addresses and 2 tests. |
| `node --test scripts/commute/api.test.mjs` | Passed; 4 tests including request validation and loopback security. |
| `node --test scripts/events/atdw.test.mjs` | Passed; 3 tests including licence/key gating. |
| `node scripts/context/refresh.mjs --check` and `node --test scripts/context/refresh.test.mjs` | Passed; exact context replay and 3 tests. |
| `uv run --python 3.12 scripts/planning/test_planning.py` | Passed; 8 baseline planning tests. |

The first attempt at the baseline planning test with plain `python` failed because that interpreter lacked `shapely`. The test declares Python 3.12 dependencies inline; `uv run --python 3.12` resolved them and passed. This was an environment invocation issue, not a failed assertion.

## Independent exact-candidate review

A separate reviewer matched the five UI file hashes to the integrated candidate, built it, and exercised a representative journey in headless Chrome 157 against the built local app on port 4188. In Kingston section 1 block 1, selecting 1 Gosse St (ACT address ID 350166) displayed block-level hazard wording, approximate straight-line amenity distances and OSM attribution. The Today view accepted destination coordinates 149.132, -35.279 and a 22 November 2026 12:00 departure; it reported journey time unavailable, five mapped road/path notices with unknown route impact, and ATDW access required. Hovering the yellow application polygon opened DA 202544308. A 360 px mobile view had no horizontal overflow. Screenshots from that review are in `C:\Users\Jimmy\AppData\Local\Temp\territory_block_desktop.png`, `territory_da_hover_desktop.png`, `territory_address_mobile_360.png` and `territory_today_desktop.png`. These temporary files are local evidence, not committed artifacts.

Separate data reviewers found the hazard block set complete at 375 and matched sampled ACT ArcGIS IDs, recomputed 41,940 amenity distances with zero errors, and passed the planning, commute and events checks. These results support the reviewed local candidate. They do not establish fresh-laptop operation, source currency, live route/timetable data or a public deployment.

## Laptop start and remaining acceptance

On the target laptop, clone the repository above, install Node.js 24 and npm, then run `npm.cmd ci`, `npm.cmd run build`, and `npm.cmd start` in the project directory. Open `http://127.0.0.1:4173/`. This path requires the final commit to be pushed first. No credentials are required for the checked-in public snapshots.

The independent local candidate review has passed. Verify that a fresh clone on the laptop starts and displays the intended Kingston sections, and record that laptop result in a follow-up project note. Live MyWay+ timetable access, a suitable routing engine such as OpenTripPlanner and an ATDW distributor licence/credential are still absent; route durations, itineraries and a dated licensed event feed remain unavailable. Do not treat a successful local build as proof of the target laptop result.
