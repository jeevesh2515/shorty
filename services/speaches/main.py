import asyncio
import os
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from edge_tts import Communicate

app = FastAPI(title="speaches-compatible-tts", version="0.2.0")

class TTSRequest(BaseModel):
    model: str = "tts-1"
    voice: str = "en-GB-SoniaNeural"
    input: str
    response_format: str = "mp3"

VOICE_MAP = {
    # OpenAI voice aliases → Edge TTS voice names
    "alloy":   "en-US-AriaNeural",
    "echo":    "en-US-GuyNeural",
    "fable":   "en-GB-RyanNeural",
    "onyx":    "en-US-OnyxNeural",
    "nova":    "en-US-NovaNeural",
    "shimmer": "en-US-ShimmerNeural",
    # Explicit Edge TTS voices pass through unchanged
}

@app.get("/health")
async def health():
    return {"status": "ok", "provider": "edge-tts-openai-compatible"}

@app.get("/v1/models")
async def list_models():
    return {"object": "list", "data": [{"id": "tts-1", "object": "model"}]}

@app.post("/v1/audio/speech")
async def audio_speech(body: TTSRequest):
    voice = VOICE_MAP.get(body.voice, body.voice)
    communicate = Communicate(body.input, voice=voice, rate="+0%", volume="+0%")
    audio = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
    if not audio:
        return JSONResponse(status_code=500, content={"error": "No audio generated"})
    return Response(content=audio, media_type="audio/mpeg")

import os

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
