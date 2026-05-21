import {
	extractSunoLinkTarget,
	extractSunoSongIdFromHtml,
	extractSunoSongIdFromLocation,
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
		).toEqual({ songId: "", slug: "XUvP6p0LhfzxJqOz" });
		expect(
			extractSunoLinkTarget(
				"https://suno.com/song/a793f774-75fc-48b0-93ea-6089c6804506"
			)
		).toEqual({
			songId: "a793f774-75fc-48b0-93ea-6089c6804506",
			slug: "",
		});
		expect(
			extractSunoLinkTarget(
				"https://suno.com/embed/a793f774-75fc-48b0-93ea-6089c6804506"
			)
		).toEqual({
			songId: "a793f774-75fc-48b0-93ea-6089c6804506",
			slug: "",
		});
	});

	test("parseSunoPageMeta reads song id and title tag artist", () => {
		const html =
			'<title>Slime Jail by Ocean Man | Suno</title>' +
			'<meta property="og:title" content="Slime Jail" />' +
			'https://suno.com/song/a793f774-75fc-48b0-93ea-6089c6804506';
		expect(extractSunoSongIdFromHtml(html)).toBe(
			"a793f774-75fc-48b0-93ea-6089c6804506"
		);
		expect(parseSunoPageMeta(html)).toEqual({
			songId: "a793f774-75fc-48b0-93ea-6089c6804506",
			title: "Slime Jail",
			creator: "Ocean Man",
		});
	});
});
