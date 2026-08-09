FROM python:3.11-slim

# Install ffmpeg for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-cache edge-tts voices list at build time to speed up first request
RUN python3 -c "import asyncio, edge_tts; asyncio.run(edge_tts.list_voices())" 2>/dev/null || true

COPY main.py .

# Railway assigns PORT dynamically; default to 8001 for local dev
EXPOSE 8001
CMD ["python", "main.py"]
