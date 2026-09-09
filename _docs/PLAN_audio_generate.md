# Plan: Audio generate through Parascene

Three repos. Provider first, then www persist, then desktop Help + suite 12.

Provider (parascene-provider)

- Methods: `replicateSpeech`, `replicateMusic`, `replicateVoiceTrain`
- Voice lists on capabilities. MiniMax includes Custom → hidden `voice_id` (`show_when`)
- Train returns `voice_id` for Custom

Www (parascene)

- Create jobs with `media_type: audio`
- Provider audio bytes → Blue CDN + cover
- Train JSON `{ voice_id }` (+ optional preview)
- Deploy www, then `POST /api/servers/1/refresh` after provider methods exist
- Until refresh, create 400s `Method not available`

Deploy / validate (before suite 12)

- Deploy parascene-provider
- Deploy parascene www (audio persist)
- Refresh server 1
- Confirm capabilities include `replicateSpeech`, `replicateMusic`, `replicateVoiceTrain` (Gemini + MiniMax voice lists, Custom → `voice_id`)
- POST speech (Gemini / Kore, short line) → poll → audio Creation (`media_type: audio`, playable `audio_url`)
- POST music (Lyria, short prompt) → same
- Then desktop suite 12

Desktop (parascene-desktop)

- Parascene Generate reads provider voice options
- Suite 12: @awesome, new project, two speakers, background, A1/A2
- One Help article. Seed 28006 stays.
