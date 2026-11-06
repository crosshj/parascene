import {
	extractSunoLinkTarget,
	extractSunoSongIdFromHtml,
	extractSunoSongIdFromLocation,
	extractSunoTargetFromLocation,
	formatSunoUnfurlTitle,
	isGenericSunoOgImage,
	isSunoSongImportUrl,
	parseSunoPageMeta,
} from "../api_routes/suno.js";

describe("suno resolve", () => {
	test("extractSunoSongIdFromLocation reads uuid from 307 Location", () => {
		expect(
			extractSunoSongIdFromLocation(
				"/song/a793f774-75fc-48b0-93ea-6089c6804506?sh=XUvP6p0LhfzxJqOz"
			)
		).toBe("a793f774-75fc-48b0-93ea-6089c6804506");
		expect(
			extractSunoSongIdFromLocation(
				"https://suno.com/song/a793f774-75fc-48b0-93ea-6089c6804506"
			)
		).toBe("a793f774-75fc-48b0-93ea-6089c6804506");
	});

	test("extractSunoLinkTarget accepts share, song, and embed urls", () => {
		expect(
			extractSunoLinkTarget("https://suno.com/s/XUvP6p0LhfzxJqOz")
		).toEqual({
			kind: "share",
			songId: "",
			slug: "XUvP6p0LhfzxJqOz",
			hookId: "",
			playlistId: "",
		});
		expect(
			extractSunoLinkTarget(
				"https://suno.com/song/a793f774-75fc-48b0-93ea-6089c6804506"
			)
		).toEqual({
			kind: "song",
			songId: "a793f774-75fc-48b0-93ea-6089c6804506",
			slug: "",
			hookId: "",
			playlistId: "",
		});
		expect(
			extractSunoLinkTarget(
				"https://suno.com/embed/a793f774-75fc-48b0-93ea-6089c6804506"
			)
		).toEqual({
			kind: "song",
			songId: "a793f774-75fc-48b0-93ea-6089c6804506",
			slug: "",
			hookId: "",
			playlistId: "",
		});
	});

	test("extractSunoLinkTarget accepts hook and playlist urls", () => {
		expect(
			extractSunoLinkTarget(
				"https://suno.com/hook/e697dc6b-7d92-4325-aec0-025b943cb976"
			)
		).toEqual({
			kind: "hook",
			songId: "",
			slug: "",
			hookId: "e697dc6b-7d92-4325-aec0-025b943cb976",
			playlistId: "",
		});
		expect(
			extractSunoLinkTarget(
				"https://suno.com/@oceanman69/hook/40df9183-e44a-4ca9-b2dd-d75862bbb21a"
			)
		).toEqual({
			kind: "hook",
			songId: "",
			slug: "",
			hookId: "40df9183-e44a-4ca9-b2dd-d75862bbb21a",
			playlistId: "",
		});
		expect(
			extractSunoLinkTarget(
				"https://suno.com/playlist/76032516-7d76-46c5-894e-197fd772ddcf"
			)
		).toEqual({
			kind: "playlist",
			songId: "",
			slug: "",
			hookId: "",
			playlistId: "76032516-7d76-46c5-894e-197fd772ddcf",
		});
		expect(
			extractSunoLinkTarget(
				"https://suno.com/@oceanman69/playlist/76032516-7d76-46c5-894e-197fd772ddcf"
			)
		).toEqual({
			kind: "playlist",
			songId: "",
			slug: "",
			hookId: "",
			playlistId: "76032516-7d76-46c5-894e-197fd772ddcf",
		});
	});

	test("extractSunoTargetFromLocation reads hook and playlist share redirects", () => {
		expect(
			extractSunoTargetFromLocation(
				"/hook/88c494a5-4630-4012-b9a9-126a97a9a800?sh=cA4P8apVojYWfRi6"
			)
		).toEqual({
			kind: "hook",
			songId: "",
			slug: "",
			hookId: "88c494a5-4630-4012-b9a9-126a97a9a800",
			playlistId: "",
		});
		expect(
			extractSunoTargetFromLocation(
				"/playlist/76032516-7d76-46c5-894e-197fd772ddcf?sh=abc"
			)
		).toEqual({
			kind: "playlist",
			songId: "",
			slug: "",
			hookId: "",
			playlistId: "76032516-7d76-46c5-894e-197fd772ddcf",
		});
		expect(
			extractSunoSongIdFromLocation(
				"/hook/88c494a5-4630-4012-b9a9-126a97a9a800?sh=cA4P8apVojYWfRi6"
			)
		).toBe("");
	});

	test("parseSunoPageMeta reads song id, title tag artist, and og:image", () => {
		const html =
			'<title>Slime Jail by Ocean Man | Suno</title>' +
			'<meta property="og:title" content="Slime Jail" />' +
			'<meta property="og:image" content="https://cdn1.suno.ai/cover.png" />' +
			'https://suno.com/song/a793f774-75fc-48b0-93ea-6089c6804506';
		expect(extractSunoSongIdFromHtml(html)).toBe(
			"a793f774-75fc-48b0-93ea-6089c6804506"
		);
		expect(parseSunoPageMeta(html)).toEqual({
			songId: "a793f774-75fc-48b0-93ea-6089c6804506",
			title: "Slime Jail",
			creator: "Ocean Man",
			ogImage: "https://cdn1.suno.ai/cover.png",
		});
	});

	test("parseSunoPageMeta works without a song uuid", () => {
		const html =
			'<title>mothers leave your young | Suno</title>' +
			'<meta property="og:title" content="mothers leave your young" />' +
			'<meta property="og:image" content="https://cdn2.suno.ai/hook-thumb.jpeg" />';
		expect(parseSunoPageMeta(html)).toEqual({
			songId: "",
			title: "mothers leave your young",
			creator: "",
			ogImage: "https://cdn2.suno.ai/hook-thumb.jpeg",
		});
	});

	test("parseSunoPageMeta drops generic marketing og:image", () => {
		expect(
			isGenericSunoOgImage("https://cdn-o.suno.com/meta-preview.jpg")
		).toBe(true);
		const html =
			'<title>A playlist | Suno</title>' +
			'<meta property="og:title" content="A playlist" />' +
			'<meta property="og:image" content="https://cdn-o.suno.com/meta-preview.jpg" />';
		expect(parseSunoPageMeta(html)).toEqual({
			songId: "",
			title: "A playlist",
			creator: "",
			ogImage: "",
		});
	});

	test("formatSunoUnfurlTitle cleans playlist and hook titles", () => {
		expect(
			formatSunoUnfurlTitle(
				"The Finest of Anglesh Qzo by @oceanman69 | Suno",
				"playlist"
			)
		).toBe("The Finest of Anglesh Qzo | Suno playlist");
		expect(formatSunoUnfurlTitle("Speed of Light-Years | Suno", "hook")).toBe(
			"Speed of Light-Years | Suno hook"
		);
		expect(
			formatSunoUnfurlTitle("The Finest of Anglesh Qzo | Suno playlist", "playlist")
		).toBe("The Finest of Anglesh Qzo | Suno playlist");
		expect(formatSunoUnfurlTitle("Speed of Light-Years | Suno hook", "hook")).toBe(
			"Speed of Light-Years | Suno hook"
		);
	});

	test("isSunoSongImportUrl rejects hook and playlist urls", () => {
		expect(
			isSunoSongImportUrl(
				"https://suno.com/song/a793f774-75fc-48b0-93ea-6089c6804506"
			)
		).toBe(true);
		expect(isSunoSongImportUrl("https://suno.com/s/XUvP6p0LhfzxJqOz")).toBe(
			true
		);
		expect(
			isSunoSongImportUrl(
				"https://suno.com/hook/e697dc6b-7d92-4325-aec0-025b943cb976"
			)
		).toBe(false);
		expect(
			isSunoSongImportUrl(
				"https://suno.com/@oceanman69/hook/40df9183-e44a-4ca9-b2dd-d75862bbb21a"
			)
		).toBe(false);
		expect(
			isSunoSongImportUrl(
				"https://suno.com/playlist/76032516-7d76-46c5-894e-197fd772ddcf"
			)
		).toBe(false);
	});
});
