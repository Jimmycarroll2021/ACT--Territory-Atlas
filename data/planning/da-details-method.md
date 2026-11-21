# DA Finder proposal descriptions

The detail file adds reviewed proposal summaries to the exact DA inventory named in `public/planning/current.json`. A DA number is the only join key. The map's parcel relationships and completed/active classification come from the pinned spatial snapshot. The optional detail stage and decision come from DA Finder at the check date (UTC). They can differ from the spatial snapshot.

## Coverage

The capture returned 80 rows for the map's 71 DA numbers. Of the 47 reviewed matches, 46 had a single row. DA 202442858 had three rows (original, S168D and S168G) and a reviewed remitted decision. Fifteen other numbers had multiple rows and remain ambiguous. Eight had no match. One description (202544528) referred to both demolition of the house and two extensions to that same house. It remains unreviewed pending clearer evidence.

“High” confidence describes the match between the reviewed source evidence and the factual summary. Construction progress and observed effects require separate evidence. Questions invite the reader to check specific features against the plans.

For a reviewed amendment, the build verifies a SHA-256 digest of the entire sorted set of captured rows, including duplicates, amendment identifiers, stages, decisions and proposal-text digests. A changed row, missing row or extra row suppresses the summary, decision and assessment facts. The review records the outcome of the signed decision explicitly. The build never ranks amendment suffixes or carries forward an original approval across amendments.

For DA 202442858 the Territory Planning Authority's [17 March 2026 remitted decision](https://dafinder.blob.core.windows.net/dadocuments/DOCs/NOTICEOFDECISION-202442858-REMITTED-SIGNED.pdf) substitutes its 26 June 2025 decision. The [17 April 2026 S187H endorsement](https://dafinder.blob.core.windows.net/dadocuments/DOCs/NOTICEOFDECISION-202442858-S187H-ENDORSEMENT-SIGNED.pdf) concerns condition 2(a)(i). The public facts cite the relevant document and page. The reviewed PDF SHA-256 digests are `e721ab177b2a0a2c99fa7a244588512f79d8aa0ec3a64fd123f95091462ec68a` and `9589d710d5383126fdafda07e7c5d1d8853be8b65a87b6f286106c12ba44272a`, respectively. Replay checks captured DA Finder rows. Rechecking the linked PDFs for replacement requires a separate document review.

## Official source and reuse

Each entry links to the official DA Finder query for its exact number. The [ArcGIS item](https://www.arcgis.com/home/item.html?id=5481eb81cb5e4634b20b51ecc72a778a) and its ISO metadata identify [ACTmapi terms](https://www.actmapi.act.gov.au/terms-and-conditions) as the use limitation. Neither states a dataset-specific CC BY licence. The product therefore provides original factual paraphrases and links; `sourceQuote` is null. Attribution for the source is ACTGOV_DAFINDER_LIST_VIEW from ACTmapi © Australian Capital Territory. The public payload includes the attribution and terms link.

The capture requests only the DA number, amendment identifier, stage, decision and proposal. The raw free text is processed in memory. Only its SHA-256 digest is retained. Applicant names, addresses, documents, contacts, staff notes and third-party descriptions are outside the payload. Editorial copy in `da-details-reviewed.json` is manually reviewed for personal details. Unexpected source text or an extra matching row automatically suppresses the previous summary. New stage or decision terms require review.

## Reproduction

Run from the project root with Python 3.10 or newer. The script uses the standard library.

```powershell
python -B scripts/planning/da_details.py --refresh
python -B scripts/planning/da_details.py --check
python -B scripts/planning/da_details.test.py
```

Live capture checks the official item, terms reference and attribution, queries batches of up to 50 numbers, matches response sizes to independent counts and verifies the layer's edit stamp before and after collection. The inventory is limited to 200 DA numbers per run. To rebuild the static file after a review using the saved minimal evidence, run `python -B scripts/planning/da_details.py --replay`. The offline check reconstructs the public bytes and compares them exactly. The regression checks include the two fixture proposals, a changed record, missing/duplicate records, contact details and a mismatched snapshot.
