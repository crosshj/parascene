import { ACTIVE_SHARE_VERSION, mintShareToken } from "../../routes/utils/shareLink.js";
import { getBaseAppUrlForEmail } from "./url.js";

const MODEL = "1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4";

export function buildEmbeddingText({ title, description, prompt }) {
	const text = (value) => (typeof value === "string" ? value.trim() : "");
	return [
		`Title: ${text(title) || "(none)"}`,
		`Description: ${text(description) || "(none)"}`,
		`Prompt: ${text(prompt) || "(none)"}`
	].join(" ");
}

function publicImageUrl(imageId, userId) {
	const id = Number(imageId);
	const uid = Number(userId);
	if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(uid) || uid <= 0) return null;
	const token = mintShareToken({ version: ACTIVE_SHARE_VERSION, imageId: id, sharedByUserId: uid });
	return `${getBaseAppUrlForEmail().replace(/\/$/, "")}/api/share/${encodeURIComponent(ACTIVE_SHARE_VERSION)}/${encodeURIComponent(token)}/image`;
}

async function clipEmbedding({ text, image }) {
	const token = process.env.REPLICATE_API_TOKEN;
	if (!token) return null;
	const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" };
	let response = await fetch("https://api.replicate.com/v1/predictions", {
		method: "POST",
		headers,
		body: JSON.stringify({ version: MODEL, input: { text, image } }),
		signal: AbortSignal.timeout(65000)
	});
	if (!response.ok) throw new Error("Replicate embedding request failed");
	let prediction = await response.json();
	const deadline = Date.now() + 60000;
	while (prediction.status !== "succeeded" && !["failed", "canceled"].includes(prediction.status) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		response = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(prediction.id)}`, {
			headers: { Authorization: headers.Authorization },
			signal: AbortSignal.timeout(10000)
		});
		if (!response.ok) throw new Error("Replicate embedding poll failed");
		prediction = await response.json();
	}
	return Array.isArray(prediction.output?.embedding) ? prediction.output.embedding : null;
}

export async function runEmbeddingJob({ client, args }) {
	const creationId = Number(args?.created_image_id);
	const userId = Number(args?.user_id);
	if (!Number.isFinite(creationId) || !Number.isFinite(userId)) return;
	if (!process.env.REPLICATE_API_TOKEN) return;
	const image = publicImageUrl(creationId, userId);
	if (!image) return;
	const prompt = args?.meta && typeof args.meta === "object" ? args.meta.args?.prompt : "";
	const embedding = await clipEmbedding({
		text: buildEmbeddingText({ title: args.title, description: args.description, prompt }),
		image
	});
	if (!embedding) return;
	const { error } = await client.from("prsn_created_embeddings").upsert({
		created_image_id: creationId,
		embedding_multi: embedding,
		model: `krthr/clip-embeddings:${MODEL}`,
		updated_at: new Date().toISOString()
	}, { onConflict: "created_image_id" });
	if (error) throw error;
}
