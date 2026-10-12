/**
 * Same access rules as GET /api/create/images/:id/image (device image share).
 * Owner, or published creation, or admin.
 */
export async function resolveCreationImageForExport({ queries, creationId, user }) {
	const id = Number(creationId);
	if (!Number.isFinite(id) || id <= 0) {
		return { ok: false, status: 400, error: "Invalid creation id" };
	}

	let image = await queries.selectCreatedImageById?.get(id, user.id);

	if (!image) {
		const any = await queries.selectCreatedImageByIdAnyUser?.get(id);
		if (!any) {
			return { ok: false, status: 404, error: "Image not found" };
		}
		const isPublished = any.published === 1 || any.published === true;
		const isAdmin = user.role === "admin";
		if (!isPublished && !isAdmin) {
			return { ok: false, status: 404, error: "Image not found" };
		}
		image = any;
	}

	const status = image.status || "completed";
	if (status !== "completed") {
		return { ok: false, status: 400, error: "Only completed creations can be exported" };
	}
	if (!image.filename) {
		return { ok: false, status: 400, error: "Image file missing" };
	}

	return { ok: true, image };
}
