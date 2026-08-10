# Building a Short

Generation is a commodity — Higgsfield, Veo, stock footage, all interchangeable. What makes
a Short feel finished is the assembly: cuts landing on meaning, captions locked to the
spoken word, music that gets out of the way, and audio at the loudness YouTube expects.

`scripts/build-short.ts` does that half, deterministically, from a JSON config. It runs
locally and costs nothing.

```bash
export SPEACHES_API_URL=https://speaches-production-293a.up.railway.app
npx tsx scripts/build-short.ts scripts/shorts/example.json
```

Output: the finished MP4, plus a `-qc.png` contact sheet and a measured loop-seam value.

---

## 1 · Generate the clips (Higgsfield)

```bash
npx skills add higgsfield-ai/skills
higgsfield auth login          # browser OAuth, no API key
```

### Budget before you generate

Automated generation **always consumes credits** — the "Unlimited" allowance on the web app
does not apply to CLI or MCP. At roughly 10 credits per 5s Kling 3.0 Std clip, a four-clip
Short costs ~40 credits, so a 100-credit month is about **two Shorts plus retries**.

Two habits that stretch it a long way:

- **Generate the still first, animate second.** Images cost a fraction of video (~2 credits
  for a Nano Banana Pro image vs ~10 for a clip). Iterate on the still until the framing is
  right, *then* spend a video credit animating it. Re-rolling video prompts blind is how
  credit runs out.
- **Spend Pro credits on one shot only.** The clip carrying the payoff deserves the quality;
  establishing and closing shots rarely do.

### Why first-frame matters

Always pass the still as the **first frame** rather than prompting straight to video. It
locks composition, colour and subject before any motion exists — which is the single
biggest factor in independently generated clips cutting together as one film.

### Getting a closing shot free

A reversed push-in becomes a pull-back. Reuse the opening clip with `"reverse": true` and
`"useTail": true` and the last frame lands exactly on the first frame — a free closing shot
*and* a seamless loop. Verified at 3/255 mean pixel difference on the HD 189733b Short.

---

## 2 · Write the config

| Field | Notes |
|---|---|
| `script` | Narration. ~64 words ≈ 28s at `rate: "+16%"`. Count words before generating clips. |
| `scenes[].endToken` | The **last spoken word** of that scene's beat. Cuts land on meaning, not a grid. |
| `scenes[].occurrence` | Which occurrence, when the word repeats. Defaults to the first. |
| `scenes[].hold` | Hold the cut past the token — a J-cut into the next line. Use it to give the hook room. |
| `scenes[].reverse` / `useTail` | The loop trick above. |
| `preroll` | Silence before the first line so the opening shot breathes. 0.6s works well. |
| `music.start` | Offset into the track. Skip a silent intro so the bed is audible from frame one. |
| `locator` | Documentary label over the opening shot — name the subject without spending narration on it. |

The last scene needs no `endToken`; it runs to the end.

---

## 3 · What the builder does

1. **Narration** — Speaches `/v1/audio/speech/timed`, returning audio *and* per-word timings.
2. **Edit plan** — converts `endToken`s into cut points, then stretches a clip only when its
   beat outruns it.
3. **Scenes** — normalises to 1080×1920/30fps, sharpens upscaled sources, reverses where asked.
4. **Captions + mix** — ASS karaoke via libass, music sidechain-ducked under speech,
   watermark burned top-left, mastered to −14 LUFS.
5. **Quality check** — contact sheet plus a measured loop seam.

---

## Things that will bite you

**Don't stretch a fast shot.** The builder warns above 1.35×. On the HD 189733b Short the
glass-rain clip initially needed 1.55×, which made "five thousand miles an hour" look slow —
the picture contradicting the narration. Fix it by moving a sentence to a neighbouring
scene, not by accepting the stretch.

**Word timings are not optional.** The builder fails loudly if Speaches returns none.
edge-tts ≥7 defaults to `SentenceBoundary` and emits **zero** word events — audio arrives
perfect and the timing list is empty, so captions silently fall back to a linear guess that
drifts up to 0.885s on a 9.6s clip.

**Higgsfield returns 716×1284**, about 66% of 1080p. The builder upscales with Lanczos and
light unsharp, but a natively-1080p clip is visibly better. Put your best-quality clip first.

**Check the word count before generating clips.** Narration length sets the edit, and clips
are the expensive part. `en-GB-RyanNeural` runs ~124 wpm at `+6%`, ~138 wpm at `+18%`.

**Watermark placement.** Shorts stacks action buttons down the right edge and puts the title
and channel name bottom-left. Top-left is the only reliably clear corner.

---

## Assets

Not committed — add locally:

- `assets/brand/watermark.png` — square, transparent, bold enough to read at ~70px
- `scripts/shorts/music/` — Mixkit's free licence covers monetised YouTube with no
  attribution. Prefer a track that **builds**; a swell that lifts on the payoff is worth
  more than a louder bed.
