/**
 * HTTP byte-range responses so browsers can seek in <video> (206 Partial Content).
 *
 * @param {import('express').Response} res
 * @param {Buffer} buffer
 * @param {{ contentType?: string, cacheControl?: string, rangeHeader?: string }} opts
 */
export function sendBufferWithRangeSupport(res, buffer, opts = {}) {
	const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
	const size = body.length;
	const contentType = opts.contentType || "application/octet-stream";
	const cacheControl = opts.cacheControl || "public, max-age=3600";
	const rangeRaw = typeof opts.rangeHeader === "string" ? opts.rangeHeader.trim() : "";

	const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(rangeRaw);
	if (rangeMatch && size > 0) {
		const startRaw = rangeMatch[1];
		const endRaw = rangeMatch[2];
		let start = startRaw === "" ? 0 : parseInt(startRaw, 10);
		let end = endRaw === "" ? size - 1 : parseInt(endRaw, 10);

		if (startRaw === "" && endRaw !== "" && Number.isFinite(end)) {
			// Suffix range: bytes=-500 (last 500 bytes)
			const suffixLen = end;
			start = Math.max(0, size - suffixLen);
			end = size - 1;
		}

		if (!Number.isFinite(start) || start < 0 || start >= size) {
			res.status(416);
			res.setHeader("Content-Range", `bytes */${size}`);
			return res.end();
		}
		if (!Number.isFinite(end) || end >= size) end = size - 1;
		if (start > end) {
			res.status(416);
			res.setHeader("Content-Range", `bytes */${size}`);
			return res.end();
		}

		const chunk = body.subarray(start, end + 1);
		res.status(206);
		res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
		res.setHeader("Content-Length", String(chunk.length));
		res.setHeader("Content-Type", contentType);
		res.setHeader("Cache-Control", cacheControl);
		res.setHeader("Accept-Ranges", "bytes");
		return res.send(chunk);
	}

	res.status(200);
	res.setHeader("Content-Type", contentType);
	res.setHeader("Content-Length", String(size));
	res.setHeader("Cache-Control", cacheControl);
	res.setHeader("Accept-Ranges", "bytes");
	return res.send(body);
}
