# Visual Sources — Shorts Autopilot

## Stack

| Priority | Source | API / Access | Licence | Notes |
|---|---|---|---|---|
| 1 | **Pexels** | REST API (`PEXELS_API_KEY`) | Pexels License — free commercial + YouTube use permitted | Primary automation path; returns video + photos. |
| 2 | **Pixabay** | REST API (`PIXABAY_API_KEY`) | Pixabay Content License — verify no visible brands/logos | Fallback when Pexels is thin on a query. |
| 3 | **Mixkit** | HTML scrape (`MIXKIT_FALLBACK=true`) | Free License confirmed per item page | Manual fallback; adapter only accepts clips whose item page carries the Free License marker. |

## Licence verification

- **Pexels**: accepted automatically. The Pexels API returns assets under the Pexels License.
- **Pixabay**: accepted automatically from the API; downstream editor must verify no visible brands/logos.
- **Mixkit**: accepted only after fetching the item page and confirming `free license` text. Clips without the marker are skipped.

Every stored `VisualAsset` now carries:
- `source` — `pexels`, `pixabay`, `mixkit`, `local-fallback`
- `license` — licence label
- `credit` — creator name
- `sourcePageUrl` — page URL for provenance / manual review

## Provenance cache

Search results are cached in `data/assets/` for 7 days to reduce API calls and preserve attribution metadata.

## Jellyfish Short acquisition

Run:
```bash
npm run acquire:jellyfish
```

This hunts the five operator queries, downloads the best video from each into `data/media/jellyfish-library/`, and seeds the DB with a 6-scene video that:
- Uses real stock footage for the hook, close-up, drifting, and seabed scenes.
- Labels the cyst-to-polyp explanation as **"Illustrated life cycle"** because generic footage is not verified *Turritopsis dohrnii* source footage.
- Writes `data/assets/jellyfish-provenance.json` for operator review.

## Manual review (first 10 Shorts)

Use **CapCut Online** for the first human-reviewed uploads:
- Vertical 9:16 crop
- Auto-captions
- Simple transitions
- TTS / narration sync
- Export MP4 for dashboard review

Once the visual standard is proven, move clip sources into the automated pipeline.
