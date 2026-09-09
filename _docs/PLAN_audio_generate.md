# Plan: Audio generate through Parascene

Three repos. Provider first, then www persist, then desktop Help + suite 12.

Provider (parascene-provider) — done, deployed

- Methods: `replicateSpeech`, `replicateMusic`, `replicateVoiceTrain`
- Gemini + MiniMax voice lists. Custom → hidden `voice_id`. MiniMax emotion select
- Speech: 2 credits, 400-char line cap
- Music: 10 credits (Lyria + Music 2.6)
- Train: 175 credits, returns `voice_id` + preview clip

Www (parascene) — done, deployed

- Create jobs with `media_type: audio`
- Provider audio bytes → Blue CDN + cover
- Train audio + `X-Voice-Id` → CDN + `meta.audio.voice_id`
- Server 1 refresh done (provider GET matches)

Desktop (parascene-desktop) — code + Help + suite 12 written

- Parascene Generate reads provider voice options
- Help: `generate-audio.html`. Seed 28006 stays.

Still to prove live

- POST speech (Gemini / Kore, short line) → audio Creation
- POST music (Lyria, short prompt) → same
- Run desktop suite 12 against live Parascene
