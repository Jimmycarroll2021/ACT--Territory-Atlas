# Kingston public hazard screening

`public/hazards/kingston.json` is a dated, static screening result for the 375 registered Kingston cadastral block polygons bundled in `public/geo/kingston-blocks.geojson`. It is not a dwelling, address, insurance, planning or emergency risk assessment.

Refresh from the repository root:

```powershell
uv run --python 3.12 scripts/hazards/refresh.py
uv run --python 3.12 scripts/hazards/refresh.py --check
uv run --python 3.12 scripts/hazards/test_refresh.py
```

The refresh requests the official [ACTmapi 1% AEP flood extent](https://services1.arcgis.com/E5n4f1VY84i0xSjy/ArcGIS/rest/services/ACTGOV_FLOOD_EXTENT/FeatureServer/0) and [ACTmapi Bushfire Prone Area Details 2026](https://services1.arcgis.com/E5n4f1VY84i0xSjy/ArcGIS/rest/services/Bushfire_Prone_Area_Details_2026/FeatureServer/0) feature layers, along with [registered ACT blocks](https://services1.arcgis.com/E5n4f1VY84i0xSjy/ArcGIS/rest/services/ACTGOV_BLOCKS/FeatureServer/0). It validates the ArcGIS catalogue licence, expected fields and GDA2020 / MGA zone 55 (EPSG:7855) layer metadata, count versus complete object-ID inventory, every feature page and source edit time. It checks the current block set and native geometry against the bundled map before publication. Geometry is clipped to the block envelope for calculation, then intersected exactly in metres. A 1 square metre envelope margin ensures an envelope cut cannot create artificial contact on a block boundary.

Each `byBlock[BLOCK_KEY]` contains `flood` and `bushfire` entries. `status` is `intersection` for positive polygon area, `no mapped intersection` otherwise, and may be `unknown` in a future incomplete source product. `areaM2` is union intersection area, so source polygon overlaps are not double counted. `sourceIds` identify positive-area source polygons; `boundaryContact` and `boundarySourceIds` distinguish zero-area edge contact. Bushfire `categories` contains categories of positive-area polygons. The top-level `sources` records catalogue, layer, edition, modification and edit times, query count and ID digest, licence, attribution and coverage statement. `data/hazards/manifest.json` records hashes. The builder publishes only after a complete successful capture and leaves the previous snapshot in place on failure.

The published flood polygons model a 1% annual exceedance probability event from available studies. They omit other flooding sources and are not real-time forecasts. The 2026 BPA polygon layer describes mapped bushfire prone area categories, not Bushfire Attack Level at a building. A block intersection can include open space or only part of a parcel; `no mapped intersection` means only that the queried source polygons did not overlap the current block geometry. See the [ACT flood map guidance](https://www.act.gov.au/environment/water/flood-maps), [ACT Emergency Services Agency bushfire guidance](https://esa.act.gov.au/be-emergency-ready/bushfires), and [ACTmapi data terms](https://www.actmapi.act.gov.au/terms-and-conditions). ACTmapi (c) Australian Capital Territory, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
