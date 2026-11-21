# DA Finder proposal descriptions

The detail file adds reviewed proposal summaries to the exact DA inventory named in `public/planning/current.json`. A DA number is the only join key. The map's parcel relationships and completed/active classification come from the pinned spatial snapshot. The optional detail stage and decision come from DA Finder at the check date (UTC). They can differ from the spatial snapshot.

## Coverage

The first capture returned 80 rows for 71 distinct requested numbers. We published 46 reviewed, single-row matches. Eight numbers had no match. Sixteen returned multiple rows including amendments and conflicting stages. Those rows remain ambiguous. One description (202544528) referred to both demolition of the house and two extensions to that same house. It remains unreviewed pending clearer evidence. The count of 71 describes the map's inventory, not all applications lodged in Kingston.

“High” confidence describes the match between a single source proposal and its reviewed factual summary. It does not establish the works were built or predict any effects on neighbouring properties. A question invites the reader to check a specific feature of the proposal against the application plans. An empty question list means impacts have not been assessed.

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
