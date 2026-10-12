// WWW CLIP search contract, adapted to the VPS-owned Supabase and HTTP clients.
const MODEL = '1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4';
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function embed(text) {
 const token = process.env.REPLICATE_API_TOKEN; if (!token) fail(503, 'Semantic search is unavailable.');
 const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=60' };
 let response = await fetch('https://api.replicate.com/v1/predictions', { method: 'POST', headers, body: JSON.stringify({ version: MODEL, input: { text } }), signal: AbortSignal.timeout(65000) });
 if (!response.ok) fail(502, 'Unable to search by meaning.');
 let prediction = await response.json();
 const deadline = Date.now() + 60000;
 while (prediction.status !== 'succeeded' && !['failed', 'canceled'].includes(prediction.status) && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  response = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(prediction.id)}`, { headers: { Authorization: headers.Authorization }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) fail(502, 'Unable to search by meaning.'); prediction = await response.json();
 }
 const embedding = prediction.output?.embedding;
 if (!Array.isArray(embedding)) fail(502, 'Unable to search by meaning.');
 return embedding;
}
export async function runSemanticSearch(client, { q, limit = 100, offset = 0 }) {
 const normalized = q.trim().toLowerCase().replace(/\s+/g, ' ');
 const cached = await client.from('prsn_search_embedding_cache').select('id,embedding').eq('normalized_query', normalized).maybeSingle();
 let embedding = cached.data?.embedding;
 if (typeof embedding === 'string') { try { embedding = JSON.parse(embedding); } catch { embedding = null; } }
 if (!Array.isArray(embedding)) {
  embedding = await embed(q);
  const saved = await client.from('prsn_search_embedding_cache').upsert({ normalized_query: normalized, embedding }, { onConflict: 'normalized_query' }).select('id').single();
  if (saved.data?.id) await client.rpc('prsn_search_embedding_cache_record_usage', { p_cache_id: saved.data.id });
 } else if (cached.data?.id) await client.rpc('prsn_search_embedding_cache_record_usage', { p_cache_id: cached.data.id });
 const { data, error } = await client.rpc('prsn_created_embeddings_nearest', { target_embedding: embedding, exclude_id: null, lim: limit + 1, off: offset });
 if (error) fail(500, 'Similarity search failed.');
 return { ids: (data || []).slice(0, limit).map(row => Number(row.created_image_id)).filter(id => Number.isSafeInteger(id) && id > 0), hasMore: (data || []).length > limit };
}
