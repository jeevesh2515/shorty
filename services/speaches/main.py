import asyncio
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
from edge_tts import Communicate

app = FastAPI(name="speaches-compatible-tts", version="0.1.0")

class TTSRequest(BaseModel):
    model: str = "tts-1"
    voice: str = "en-GB-SoniaNeural"
    input: str
    response_format: str = "mp3"

@app.get("/health")
async def health():
    return {"status": "ok", "provider": "edge-tts-wrapper"}

@app.post("/v1/audio/speech")
async def audio_speech(body: TTSRequest):
    communicate = Communicate(body.input, voice=body.voice, rate="+0%", volume="+0%")
    audio = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
    return Response(content=audio, media_type="audio/mpeg")

import os

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)

