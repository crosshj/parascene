import { crc32 } from "node:zlib";
import { getBaseAppUrlForEmail } from "./url.js";

const SOFTWARE = "Parascene";
const TRAINED_ALGORITHM_SOURCE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const COMPOSITE_ALGORITHM_SOURCE = "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PROMPT_MAX = 2000;

function emptyRecord() {
	return {
		present: false,
		software: "",
		title: "",
		creationUrl: "",
		composite: false,
		model: "",
		method: "",
		prompt: "",
		seed: "",
		digitalSourceTypes: []
	};
}

function metaObject(image) {
	const raw = image?.meta;
	if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw !== "string") return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function clipText(value, max) {
	if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
	if (typeof value !== "string") return "";
	return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

function factsFromImage(image, options = {}) {
	const meta = metaObject(image);
	const args = meta.args && typeof meta.args === "object" && !Array.isArray(meta.args) ? meta.args : {};
	const method = clipText(meta.method, 200);
	const usableMethod = /^(get|post|put|patch|delete)$/i.test(method) ? "" : method;
	const id = Number(image?.id);
	return {
		software: SOFTWARE,
		title: clipText(image?.title, 200),
		creationUrl: Number.isSafeInteger(id) && id > 0 ? `${getBaseAppUrlForEmail()}/creations/${id}` : "",
		composite: options.composite === true,
		model: clipText(args.model, 200),
		method: usableMethod,
		prompt: clipText(args.prompt, PROMPT_MAX),
		seed: clipText(args.seed, 80)
	};
}

function imageKind(buffer) {
	if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
	if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
	return "";
}

function finish(record) {
	record.composite = record.digitalSourceTypes.some((uri) => uri.includes("compositeWithTrainedAlgorithmicMedia"));
	record.present = record.digitalSourceTypes.some((uri) => uri.includes("trainedAlgorithmicMedia"));
	return record;
}

function addSource(record, value) {
	const matches = String(value || "").match(/http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/[A-Za-z0-9]+/g) || [];
	for (const uri of matches) {
		if (!record.digitalSourceTypes.includes(uri)) record.digitalSourceTypes.push(uri);
	}
}

function unescapeXml(value) {
	return String(value || "")
		.replace(/&quot;/g, "\"")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function applyXmp(record, xmp) {
	const attr = (name) => {
		const match = xmp.match(new RegExp(`${name}="([^"]*)"`));
		return match ? unescapeXml(match[1]) : "";
	};
	const element = (tag) => {
		const match = xmp.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
		if (!match) return "";
		const text = match[1].match(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/);
		return unescapeXml(text ? text[1] : match[1]);
	};
	if (!record.software) record.software = attr("xmp:CreatorTool");
	if (!record.model) record.model = attr("parascene:model");
	if (!record.method) record.method = attr("parascene:method");
	if (!record.seed) record.seed = attr("parascene:seed");
	if (!record.title) record.title = element("dc:title");
	if (!record.prompt) record.prompt = element("dc:description");
	if (!record.creationUrl) record.creationUrl = element("dcterms:provenance");
	addSource(record, xmp);
}

function parseItxt(data) {
	const keywordEnd = data.indexOf(0);
	if (keywordEnd < 0) return null;
	let index = keywordEnd + 1;
	if (index + 2 > data.length) return null;
	const compressed = data[index] === 1;
	index += 2;
	const languageEnd = data.indexOf(0, index);
	if (languageEnd < 0) return null;
	index = languageEnd + 1;
	const translatedEnd = data.indexOf(0, index);
	if (translatedEnd < 0) return null;
	const text = data.subarray(translatedEnd + 1);
	if (compressed) return null;
	return { keyword: data.subarray(0, keywordEnd).toString("latin1"), text: text.toString("utf8") };
}

function applyText(record, keyword, value) {
	if (keyword === "Software" && !record.software) record.software = value;
	if (keyword === "Source" && !record.creationUrl) record.creationUrl = value;
	if (keyword === "Model" && !record.model) record.model = value;
	if (keyword === "Method" && !record.method) record.method = value;
	if (keyword === "Seed" && !record.seed) record.seed = value;
	if (keyword === "Prompt" && !record.prompt) record.prompt = value;
	if (keyword === "DigitalSourceType") addSource(record, value);
	if (keyword === "XML:com.adobe.xmp") applyXmp(record, value);
}

function readPng(png) {
	const record = emptyRecord();
	let pos = 8;
	while (pos + 8 <= png.length) {
		const length = png.readUInt32BE(pos);
		const type = png.subarray(pos + 4, pos + 8).toString("ascii");
		const next = pos + 12 + length;
		if (next > png.length) break;
		const data = png.subarray(pos + 8, pos + 8 + length);
		if (type === "tEXt") {
			const split = data.indexOf(0);
			if (split >= 0) applyText(record, data.subarray(0, split).toString("latin1"), data.subarray(split + 1).toString("latin1"));
		} else if (type === "iTXt") {
			const parsed = parseItxt(data);
			if (parsed) applyText(record, parsed.keyword, parsed.text);
		} else if (type === "eXIf" && !record.software && data.includes(Buffer.from("Parascene"))) {
			record.software = SOFTWARE;
		}
		if (type === "IEND") break;
		pos = next;
	}
	return finish(record);
}

function readJpeg(jpeg) {
	const record = emptyRecord();
	let pos = 2;
	while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
		const marker = jpeg[pos + 1];
		if (marker === 0xd8 || marker === 0xd9) {
			pos += 2;
			continue;
		}
		if (marker === 0xda || marker === 0x00) break;
		const length = jpeg.readUInt16BE(pos + 2);
		const next = pos + 2 + length;
		if (length < 2 || next > jpeg.length) break;
		const payload = jpeg.subarray(pos + 4, next);
		if (marker === 0xe1 && payload.subarray(0, 29).toString("latin1").startsWith("http://ns.adobe.com/xap/1.0/")) {
			applyXmp(record, payload.subarray(29).toString("utf8"));
		} else if (marker === 0xe1 && payload.subarray(0, 4).toString("latin1") === "Exif" && !record.software && payload.includes(Buffer.from("Parascene"))) {
			record.software = SOFTWARE;
		}
		pos = next;
	}
	return finish(record);
}

/**
 * Read the provenance record embedded in a PNG or JPEG.
 * `present` is true when the file carries an IPTC trainedAlgorithmicMedia source.
 *
 * @param {Buffer} buffer
 */
export function readProvenance(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 8) return emptyRecord();
	const kind = imageKind(buffer);
	if (kind === "png") return readPng(buffer);
	if (kind === "jpeg") return readJpeg(buffer);
	return emptyRecord();
}

/**
 * Write provenance into a PNG or JPEG when the file does not already have it.
 * Pass the creation row. `composite` marks a watermarked or otherwise composited copy.
 * A re-encode drops the record, so callers run this again on the new bytes.
 *
 * @param {Buffer} buffer
 * @param {object | null | undefined} image
 * @param {{ composite?: boolean }} [options]
 * @returns {Buffer}
 */
export function writeProvenance(buffer, image, options = {}) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 8) return buffer;
	if (readProvenance(buffer).present) return buffer;
	const facts = factsFromImage(image, options);
	const kind = imageKind(buffer);
	if (kind === "png") return embedPng(buffer, facts);
	if (kind === "jpeg") return embedJpeg(buffer, facts);
	return buffer;
}

function sourceUris(facts) {
	const uris = [TRAINED_ALGORITHM_SOURCE];
	if (facts.composite) uris.push(COMPOSITE_ALGORITHM_SOURCE);
	return uris;
}

function xmlText(value) {
	return String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
}

function xmlAttr(value) {
	return xmlText(value).replace(/"/g, "&quot;");
}

function buildXmp(facts) {
	const software = facts.software || SOFTWARE;
	const sources = sourceUris(facts).map((uri) => `<rdf:li>${xmlText(uri)}</rdf:li>`).join("");
	const title = facts.title
		? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(facts.title)}</rdf:li></rdf:Alt></dc:title>`
		: "";
	const description = facts.prompt
		? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(facts.prompt)}</rdf:li></rdf:Alt></dc:description>`
		: "";
	const provenance = facts.creationUrl ? `<dcterms:provenance>${xmlText(facts.creationUrl)}</dcterms:provenance>` : "";
	const generation = [
		facts.model ? `parascene:model="${xmlAttr(facts.model)}"` : "",
		facts.method ? `parascene:method="${xmlAttr(facts.method)}"` : "",
		facts.seed ? `parascene:seed="${xmlAttr(facts.seed)}"` : ""
	].filter(Boolean).join(" ");
	return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""
 xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
 xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
 xmlns:parascene="https://parascene.com/ns/provenance/1.0/"
 xmp:CreatorTool="${xmlAttr(software)}"
 tiff:Software="${xmlAttr(software)}"
 photoshop:Credit="${xmlAttr(software)}"
 ${generation}>
<Iptc4xmpExt:DigitalSourceType><rdf:Bag>${sources}</rdf:Bag></Iptc4xmpExt:DigitalSourceType>
<dc:creator><rdf:Seq><rdf:li>${xmlText(software)}</rdf:li></rdf:Seq></dc:creator>
${title}${description}${provenance}
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function statement(facts) {
	const kind = facts.composite ? "compositeWithTrainedAlgorithmicMedia" : "trainedAlgorithmicMedia";
	const model = facts.model ? ` Model: ${facts.model}.` : "";
	const where = facts.creationUrl ? ` ${facts.creationUrl}` : "";
	return `AI-generated by ${facts.software || SOFTWARE}.${model} DigitalSourceType: ${kind}.${where}`;
}

function latin1(value) {
	return Buffer.from(String(value ?? "").replace(/[^\x00-\xff]/g, "?"), "latin1");
}

function pngChunk(type, data) {
	const typeBuf = Buffer.from(type, "ascii");
	const header = Buffer.alloc(4);
	header.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
	return Buffer.concat([header, typeBuf, data, crc]);
}

function textChunk(keyword, value) {
	return pngChunk("tEXt", Buffer.concat([latin1(keyword), Buffer.from([0]), latin1(value)]));
}

function itxtChunk(keyword, value) {
	return pngChunk("iTXt", Buffer.concat([
		latin1(keyword),
		Buffer.from([0, 0, 0]),
		Buffer.from([0, 0]),
		Buffer.from(String(value ?? ""), "utf8")
	]));
}

function exifSoftwareTiff(software) {
	const text = latin1(`${software}\0`);
	const ifdStart = 8;
	const valueOffset = ifdStart + 2 + 12 + 4;
	const tiff = Buffer.alloc(valueOffset + text.length);
	tiff.write("II", 0, "ascii");
	tiff.writeUInt16LE(42, 2);
	tiff.writeUInt32LE(ifdStart, 4);
	tiff.writeUInt16LE(1, ifdStart);
	tiff.writeUInt16LE(0x0131, ifdStart + 2);
	tiff.writeUInt16LE(2, ifdStart + 4);
	tiff.writeUInt32LE(text.length, ifdStart + 6);
	if (text.length <= 4) text.copy(tiff, ifdStart + 10);
	else {
		tiff.writeUInt32LE(valueOffset, ifdStart + 10);
		text.copy(tiff, valueOffset);
	}
	return tiff;
}

function jpegApp1(identifier, data) {
	const body = Buffer.concat([identifier, data]);
	const segment = Buffer.alloc(4 + body.length);
	segment[0] = 0xff;
	segment[1] = 0xe1;
	segment.writeUInt16BE(body.length + 2, 2);
	body.copy(segment, 4);
	return segment;
}

function embedPng(png, facts) {
	if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return png;
	let pos = 8;
	while (pos + 8 <= png.length) {
		const length = png.readUInt32BE(pos);
		const type = png.subarray(pos + 4, pos + 8).toString("ascii");
		const next = pos + 12 + length;
		if (next > png.length) return png;
		if (type === "IEND") {
			const software = facts.software || SOFTWARE;
			const chunks = [
				pngChunk("eXIf", exifSoftwareTiff(software)),
				textChunk("Software", software),
				textChunk("Comment", statement(facts)),
				textChunk("DigitalSourceType", sourceUris(facts).join(" "))
			];
			if (facts.creationUrl) chunks.push(textChunk("Source", facts.creationUrl));
			if (facts.model) chunks.push(itxtChunk("Model", facts.model));
			if (facts.method) chunks.push(itxtChunk("Method", facts.method));
			if (facts.seed) chunks.push(itxtChunk("Seed", facts.seed));
			if (facts.prompt) chunks.push(itxtChunk("Prompt", facts.prompt));
			chunks.push(itxtChunk("XML:com.adobe.xmp", buildXmp(facts)));
			return Buffer.concat([png.subarray(0, pos), ...chunks, png.subarray(pos)]);
		}
		pos = next;
	}
	return png;
}

function embedJpeg(jpeg, facts) {
	if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
	const software = facts.software || SOFTWARE;
	const xmp = Buffer.from(buildXmp(facts), "utf8");
	if (xmp.length + 64 > 65535) return jpeg;
	const exif = jpegApp1(Buffer.from("Exif\0\0", "latin1"), exifSoftwareTiff(software));
	const xmpSeg = jpegApp1(Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), xmp);
	const comment = latin1(statement(facts));
	const com = Buffer.alloc(4 + comment.length);
	com[0] = 0xff;
	com[1] = 0xfe;
	com.writeUInt16BE(comment.length + 2, 2);
	comment.copy(com, 4);
	return Buffer.concat([jpeg.subarray(0, 2), exif, xmpSeg, com, jpeg.subarray(2)]);
}
