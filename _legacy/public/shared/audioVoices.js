export const GEMINI_SYSTEM_VOICES = [
	{ value: "Achernar", label: "Achernar — Female; soft and understated" },
	{ value: "Achird", label: "Achird — Male; friendly and approachable" },
	{ value: "Algenib", label: "Algenib — Male; gravelly and textured" },
	{ value: "Algieba", label: "Algieba — Male; smooth and polished" },
	{ value: "Alnilam", label: "Alnilam — Male; firm and authoritative" },
	{ value: "Aoede", label: "Aoede — Female; breezy and relaxed" },
	{ value: "Autonoe", label: "Autonoe — Female; bright and energetic" },
	{ value: "Callirrhoe", label: "Callirrhoe — Female; easygoing and unforced" },
	{ value: "Charon", label: "Charon — Male; informative and composed" },
	{ value: "Despina", label: "Despina — Female; smooth and controlled" },
	{ value: "Enceladus", label: "Enceladus — Male; breathy and intimate" },
	{ value: "Erinome", label: "Erinome — Female; clear and articulate" },
	{ value: "Fenrir", label: "Fenrir — Male; excitable and energetic" },
	{ value: "Gacrux", label: "Gacrux — Mature female; grounded and experienced" },
	{ value: "Iapetus", label: "Iapetus — Male; clear and steady" },
	{ value: "Kore", label: "Kore — Female; firm and confident" },
	{ value: "Laomedeia", label: "Laomedeia — Female; upbeat and cheerful" },
	{ value: "Leda", label: "Leda — Young female; youthful and light" },
	{ value: "Orus", label: "Orus — Male; firm and direct" },
	{ value: "Pulcherrima", label: "Pulcherrima — Female; forward and assertive" },
	{ value: "Puck", label: "Puck — Male; upbeat and playful" },
	{ value: "Rasalgethi", label: "Rasalgethi — Male; informative and measured" },
	{ value: "Sadachbia", label: "Sadachbia — Male; lively and animated" },
	{ value: "Sadaltager", label: "Sadaltager — Male; knowledgeable and assured" },
	{ value: "Schedar", label: "Schedar — Male; even and balanced" },
	{ value: "Sulafat", label: "Sulafat — Female; warm and welcoming" },
	{ value: "Umbriel", label: "Umbriel — Male; easygoing and calm" },
	{ value: "Vindemiatrix", label: "Vindemiatrix — Female; gentle and tender" },
	{ value: "Zephyr", label: "Zephyr — Female; bright and airy" },
	{ value: "Zubenelgenubi", label: "Zubenelgenubi — Male; casual and conversational" }
];

export const MINIMAX_SYSTEM_VOICES = [
	{ value: "English_expressive_narrator", label: "Expressive narrator" },
	{ value: "English_radiant_girl", label: "Radiant girl" },
	{ value: "English_magnetic_voiced_man", label: "Magnetic man" },
	{ value: "English_compelling_lady1", label: "Compelling lady" },
	{ value: "English_Aussie_Bloke", label: "Aussie bloke" },
	{ value: "English_captivating_female1", label: "Captivating female" },
	{ value: "English_Upbeat_Woman", label: "Upbeat woman" },
	{ value: "English_Trustworth_Man", label: "Trustworthy man" },
	{ value: "English_CalmWoman", label: "Calm woman" },
	{ value: "English_ReservedYoungMan", label: "Reserved young man" },
	{ value: "English_PlayfulGirl", label: "Playful girl" },
	{ value: "English_ManWithDeepVoice", label: "Deep-voiced man" },
	{ value: "English_Graceful_Lady", label: "Graceful lady" },
	{ value: "English_CasualMan", label: "Casual man" }
];

/** Spoken line cap so 2 credits (~3.4¢) covers Gemini (~30s) and MiniMax. */
export const SPEECH_PROMPT_MAX_CHARS = 400;

export const MINIMAX_SPEECH_VOICE_OPTIONS = [
	...MINIMAX_SYSTEM_VOICES,
	{ value: "custom", label: "Custom" }
];

/** Official MiniMax speech-2.8 emotion enum. */
export const MINIMAX_SPEECH_EMOTION_VALUES = [
	"auto",
	"happy",
	"sad",
	"angry",
	"fearful",
	"disgusted",
	"surprised",
	"calm",
	"fluent",
	"neutral"
];

export const MINIMAX_SPEECH_EMOTIONS = MINIMAX_SPEECH_EMOTION_VALUES.map((value) => ({
	value,
	label: `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}));

export function normalizeMinimaxEmotion(raw) {
	const key = String(raw ?? "").trim().toLowerCase();
	return MINIMAX_SPEECH_EMOTION_VALUES.includes(key) ? key : "";
}
