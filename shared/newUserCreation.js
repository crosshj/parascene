/** A creation that introduces a new account: the automatic welcome post or profile portrait. */

export function isNewUserCreation(row) {
	const meta = parseMeta(row?.meta);
	if (meta.new_user === true) return true;
	const title = String(row?.title || "").trim();
	if (title.startsWith("Welcome @") || title === "Profile portrait") return true;
	const filename = String(row?.filename || "");
	return filename.startsWith("welcome_");
}

function parseMeta(value) {
	if (value && typeof value === "object" && !Array.isArray(value)) return value;
	if (typeof value !== "string" || !value.trim()) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
