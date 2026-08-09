"""
OpenAI-compatible TTS microservice backed by Microsoft Edge Neural voices.

Beyond plain synthesis this exposes **word-level timings**. edge-tts already emits
`WordBoundary` events during streaming; the previous version discarded them, which forced
the renderer to guess caption timing by spreading words evenly across the clip duration.
That guess drifts against real speech — pauses, sentence breaks and long words all push it
out — and the error compounds toward the end of a Short.

Capturing the boundaries costs nothing and makes captions frame-accurate.

Endpoints:
    GET  /health                  service + capability probe
    GET  /v1/voices               available voices (for per-video voice rotation)
    POST /v1/audio/speech         OpenAI-compatible, returns raw MP3 bytes
    POST /v1/audio/speech/timed   MP3 (base64) + per-word start/end times
"""

import base64
import os
from typing import Any, Dict, List, Optional, Tuple

from edge_tts import Communicate, list_voices
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

app = FastAPI(title="speaches-compatible-tts", version="0.3.0")

# edge-tts reports offsets in 100-nanosecond ticks.
TICKS_PER_SECOND = 10_000_000

DEFAULT_VOICE = "en-GB-SoniaNeural"

VOICE_MAP = {
    # OpenAI voice aliases -> Edge TTS voice names
    "alloy": "en-US-AriaNeural",
    "echo": "en-US-GuyNeural",
    "fable": "en-GB-RyanNeural",
    "onyx": "en-US-OnyxNeural",
    "nova": "en-US-NovaNeural",
    "shimmer": "en-US-ShimmerNeural",
    # Explicit Edge TTS voices pass through unchanged
}


class TTSRequest(BaseModel):
    model: str = "tts-1"
    voice: str = DEFAULT_VOICE
    input: str
    response_format: str = "mp3"
    # Prosody controls. Exposed so the pipeline can vary delivery between videos —
    # identical narration on every upload is exactly what YouTube's inauthentic-content
    # policy flags.
    rate: str = "+0%"
    pitch: str = "+0Hz"
    volume: str = "+0%"


def resolve_voice(voice: Optional[str]) -> str:
    if not voice:
        return DEFAULT_VOICE
    return VOICE_MAP.get(voice, voice)


async def synthesize(
    text: str,
    voice: str,
    rate: str = "+0%",
    pitch: str = "+0Hz",
    volume: str = "+0%",
) -> Tuple[bytes, List[Dict[str, Any]]]:
    """
    Stream synthesis, accumulating audio bytes and word boundaries in one pass.

    Returns (mp3_bytes, words) where each word is {text, start, end} in seconds.
    """
    base: Dict[str, str] = {"rate": rate, "volume": volume}

    # `boundary` is the critical one: edge-tts >=7 defaults to "SentenceBoundary", which
    # emits NO per-word events at all. Without this the stream yields perfect audio and an
    # empty timing list, and captions silently fall back to the linear guess. Verified
    # against edge-tts 7.2.8 -- 25 words in, 25 boundaries out.
    #
    # `pitch` and `boundary` are both keyword-only additions that older releases lack, so
    # degrade one argument at a time rather than failing the whole render.
    attempts: List[Dict[str, str]] = [
        {**base, "pitch": pitch, "boundary": "WordBoundary"},
        {**base, "boundary": "WordBoundary"},
        {**base, "pitch": pitch},
        {**base},
    ]

    communicate = None
    for kwargs in attempts:
        try:
            communicate = Communicate(text, voice=voice, **kwargs)
            break
        except TypeError:
            continue
    if communicate is None:
        raise RuntimeError("edge-tts Communicate rejected every argument combination")

    audio = bytearray()
    words: List[Dict[str, Any]] = []

    async for chunk in communicate.stream():
        chunk_type = chunk.get("type")
        if chunk_type == "audio" and chunk.get("data"):
            audio.extend(chunk["data"])
        elif chunk_type == "WordBoundary":
            offset = chunk.get("offset", 0)
            duration = chunk.get("duration", 0)
            words.append(
                {
                    "text": chunk.get("text", ""),
                    "start": round(offset / TICKS_PER_SECOND, 3),
                    "end": round((offset + duration) / TICKS_PER_SECOND, 3),
                }
            )

    return bytes(audio), words


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "provider": "edge-tts-openai-compatible",
        "version": app.version,
        # The Node client probes this to decide whether it can request timed audio.
        "capabilities": {"word_timings": True, "prosody": True, "voice_list": True},
    }


@app.get("/v1/models")
async def list_models():
    return {"object": "list", "data": [{"id": "tts-1", "object": "model"}]}


@app.get("/v1/voices")
async def voices(locale: str = "en"):
    """Available neural voices, optionally filtered by locale prefix (e.g. 'en-GB')."""
    try:
        all_voices = await list_voices()
    except Exception as exc:  # network hiccup against the MS endpoint
        return JSONResponse(status_code=502, content={"error": f"voice list unavailable: {exc}"})

    filtered = [
        {
            "name": v.get("ShortName"),
            "gender": v.get("Gender"),
            "locale": v.get("Locale"),
        }
        for v in all_voices
        if not locale or str(v.get("Locale", "")).lower().startswith(locale.lower())
    ]
    return {"object": "list", "data": filtered, "count": len(filtered)}


@app.post("/v1/audio/speech")
async def audio_speech(body: TTSRequest):
    """OpenAI-compatible endpoint. Unchanged contract: raw MP3 bytes."""
    voice = resolve_voice(body.voice)
    try:
        audio, _ = await synthesize(body.input, voice, body.rate, body.pitch, body.volume)
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": f"synthesis failed: {exc}"})
    if not audio:
        return JSONResponse(status_code=500, content={"error": "No audio generated"})
    return Response(content=audio, media_type="audio/mpeg")


@app.post("/v1/audio/speech/timed")
async def audio_speech_timed(body: TTSRequest):
    """
    Synthesis plus word-level timings.

    Audio is base64-encoded so timings and bytes arrive together — a 30s Short is roughly
    90KB of MP3, so ~120KB of JSON. Well within a single response.
    """
    voice = resolve_voice(body.voice)
    try:
        audio, words = await synthesize(body.input, voice, body.rate, body.pitch, body.volume)
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": f"synthesis failed: {exc}"})

    if not audio:
        return JSONResponse(status_code=500, content={"error": "No audio generated"})

    # Last boundary is the best in-band duration estimate. The caller still probes the
    # real file with ffprobe — trailing silence is not covered by a word boundary.
    duration = words[-1]["end"] if words else 0.0

    return {
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "format": "mp3",
        "voice": voice,
        "duration": duration,
        "word_count": len(words),
        "words": words,
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
