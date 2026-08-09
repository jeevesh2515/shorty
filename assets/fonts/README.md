# Caption fonts

Captions are burned in with libass, which needs a real font file rather than the
hand-rolled bitmap glyphs the renderer used previously.

## Anton (primary)

- **Family:** Anton
- **Licence:** SIL Open Font License 1.1 — free to bundle, embed, and use commercially
- **Source:** https://github.com/google/fonts/tree/main/ofl/anton

Anton is a heavy condensed grotesque. It holds up at Shorts scale, where a caption has to
stay legible over moving footage on a phone screen.

**It is not committed to this repo.** The `Dockerfile` downloads it during the image build.
A 170KB binary is awkward to review in diffs and to move through tooling, and fetching it
at build time keeps the repo text-only.

## Fallback

If the download fails — offline build, CDN blip — the build does **not** fail. It falls
back to **DejaVu Sans Bold**, installed via `fonts-dejavu-core` in the same Dockerfile
layer, so a caption face is always present.

`resolveCaptionFont()` in `server/captions.ts` checks for `Anton-Regular.ttf` on disk and
names the fallback in the generated ASS when it is missing. This matters: naming a font
fontconfig cannot resolve makes libass silently substitute an arbitrary face — usually a
serif, which looks wrong on a Short — rather than raising an error.

## Local development

To render with Anton locally, drop `Anton-Regular.ttf` into this directory:

```bash
curl -fsSL -o assets/fonts/Anton-Regular.ttf \
  https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf
```

`.gitignore` excludes `*.ttf` here, so a local copy will not be committed by accident.
