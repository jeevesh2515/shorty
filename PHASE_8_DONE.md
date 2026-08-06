# Phase 8 — LoidLoveScience Jellyfish Short & Review-First Pipeline

**Status:** ✅ Complete  
**Date:** 2026-08-06  

## Summary

Upgraded Shorts Autopilot for the **LoidLoveScience** science channel with a high-retention, fact-checked Short on *Turritopsis dohrnii* (the immortal jellyfish) and a human-in-the-loop review pipeline.

---

## 1. Jellyfish Short Specifications

- **Topic:** The Immortal Jellyfish — Nature's Reset Button
- **Niche:** Science
- **Narration:** Fact-checked narration covering transdifferentiation, cyst collapse, polyp growth, and human longevity research.
- **Duration:** 30 seconds
- **Visuals:** 6 visual scenes representing:
  1. Deep Ocean (drifting medusa)
  2. Turritopsis dohrnii close-up
  3. Seabed cyst collapse
  4. Young polyp growth
  5. Laboratory microscope analysis
  6. DNA helix genetics
- **Captions:** Automatically timed 4-word uppercase SRT cues burned in / fallback formatted.
- **Factual Sources:** 
  - PubMed: [https://pubmed.ncbi.nlm.nih.gov/31619459/](https://pubmed.ncbi.nlm.nih.gov/31619459/)
  - PNAS: [https://doi.org/10.1073/pnas.2118763119](https://doi.org/10.1073/pnas.2118763119)

---

## 2. Technical Enhancements

### Renderer Resiliency (`server/providers.ts`)
- **Scene Palettes:** Implemented 6 distinct color gradients for fallback scene frames so that local-fallback videos have rich visual rhythm without external image dependencies.
- **FFmpeg Filter Protection:** Added automatic fallback if local FFmpeg lacks `libass`/`subtitles` filter support. Video rendering will complete cleanly on all platforms.

### Seed Script (`scripts/seed-jellyfish.ts`)
- Executable via `npm run seed:jellyfish`.
- Automatically populates Topic, Script, and Video entities into SQLite with full render manifest.

---

## 3. How to Run & Verify

1. **Seed the Jellyfish Short:**
   ```bash
   npm run seed:jellyfish
   ```
2. **Start backend API:**
   ```bash
   npm run dev:api
   ```
3. **Render video:**
   ```bash
   curl -X POST http://localhost:8787/api/videos/<VIDEO_ID>/render
   ```
4. **Approve for 18:00 London publishing slot:**
   Click **Approve for 18:00 tomorrow** in the dashboard UI or call `/api/uploads/<ID>/approve`.

---

## Verification

- `npm run build` — Clean TypeScript + Vite compilation.
- `npm test` — All test suites pass.
- FFmpeg 9:16 vertical render tested end-to-end.
