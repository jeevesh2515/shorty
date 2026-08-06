# Rules – Shorts Autopilot

## Prompt rules (Base44)

1. **Plan before prompting**:
   - Draft the full change in `10_MEMORY.md` or a scratch pad.
   - Combine related changes into one prompt.
2. **Prefer Discuss mode (0.3 credits)** for:
   - Architecture discussions
   - Debugging strategies
   - Planning workflows
3. **Use targeted builder prompts** for:
   - Creating entities, pages, workflows
   - Wiring integrations
4. **Never re-prompt to fix small UI issues**:
   - Use manual drag/drop/edit in the visual editor.
5. **Use Revert** instead of re-prompting when a change goes wrong.

## Architecture rules

1. **Own API keys for AI-heavy work**:
   - All LLM calls (topic, script, metadata) go through backend functions with your keys.
   - All TTS via Dograh (self-hosted, BYOK) — zero per-call cost.
   - All video/image generation via your keys.
2. **Base44 integration credits only for**:
   - Platform-level features (file uploads, emails, basic connectors).
3. **State is in entities**:
   - Topic, Script, Video, Upload, Analytics entities hold all persistent state.
4. **Workflows are idempotent**:
   - Re-running a daily workflow should not create duplicate uploads.
   - Use status fields (e.g., `status: pending | generating | uploaded | failed`).

## Data rules

1. **Every asset is tracked**:
   - Each Short has a Topic, Script, Video, and Upload record.
2. **Logs over guesses**:
   - Never rely on memory; log decisions (why a topic was chosen, etc.).
3. **PII minimal**:
   - No need to store user data beyond your own channel info.

## YouTube policy rules

1. **Originality**:
   - Scripts must be AI-generated but non-generic; avoid copying existing scripts.
2. **Value**:
   - Each Short should educate, entertain, or inspire—not just rehash trending audio.
3. **No spam**:
   - Avoid mass-uploading near-duplicate content.
4. **Music**:
   - Use licensed or platform-provided audio where possible.

## Cost rules

1. **Track AI costs**:
   - Log estimated token usage and costs per Short in `Analytics`.
2. **Budget guardrails**:
   - Set a monthly cap for your AI APIs; stop automation if exceeded.
3. **Monitor Base44 credits**:
   - Check remaining messages and integration credits before heavy sessions.
4. **Dograh is free when self-hosted**:
   - Only cost is hosting (local Docker = free, VPS = ~$5/month).
   - Track uptime and reliability of the Dograh instance.
