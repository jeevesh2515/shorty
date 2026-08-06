# Product Requirements Document (PRD) – Shorts Autopilot

## Vision

Build an agentic AI system that automatically:
1. Discovers high-potential YouTube Shorts topics daily
2. Generates short-form video content (script + voice + visuals)
3. Publishes to YouTube on a consistent daily schedule
4. Tracks performance and iterates toward monetisation

## Target user

- You (single creator) as operator and overseer
- Eventually: small team or additional channels

## Core objectives

- **Consistency**: Publish at least 1 Short per day, every day.
- **Quality**: Content must meet YouTube's originality and engagement standards.
- **Monetisation-ready**: Channel must qualify for YPP (Shorts-focused path) as fast as possible.
- **Low credit burn**: Use Base44 free tier efficiently; route heavy AI work through your own API keys.

## Success metrics

- **Output**: ≥ 25 Shorts published in first 30 days.
- **Engagement**: Average view duration ≥ 40% for Shorts after first 10 uploads.
- **Monetisation**: Channel meets YouTube Partner Program thresholds within 90 days:
  - 500 subscribers + 3M Shorts views (12 months) or other YPP path.
- **Cost**: Base44 integration credits < 100 over first 6 weeks; AI costs via your own keys under a defined monthly budget.

## Scope (MVP)

In scope:
- Daily topic selection (trending + evergreen niches)
- Script generation (15–45 seconds)
- Voiceover via Dograh (self-hosted TTS) and background music
- Visuals (stock/AI-generated or simple motion graphics)
- Vertical 9:16 video assembly
- YouTube upload with title, description, tags, thumbnail
- Basic analytics logging (views, watch time, CTR)

Out of scope (for now):
- Multi-channel management
- TikTok/Reels cross-posting (can be added later)
- Complex human-in-the-loop approvals beyond optional daily review

## Constraints

- Base44 free plan:
  - 25 messages/month, 5/day
  - 100 integration credits starter bundle
- Must use your own API keys for:
  - LLM calls (e.g., OpenAI/Gemini)
  - TTS via Dograh (self-hosted — https://github.com/dograh-hq/dograh)
  - Video generation, image generation
  - YouTube Data API
- Must be robust to rate limits and API failures.

## Risks

- YouTube policy violations (reused content, low-effort spam)
- Over-reliance on trending topics leading to niche drift
- Integration credit exhaustion during development
- API key cost overruns if not monitored
- Dograh self-hosting reliability (Docker uptime, resource usage)

## Non-functional requirements

- **Observability**: All key steps logged (topic, script, video, upload, metrics).
- **Recoverability**: Failed runs can be retried without duplicating uploads.
- **Extensibility**: Easy to add new agents (e.g., thumbnail generator, A/B test titles).
