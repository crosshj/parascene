import { parseGpuOccupancy, occupancyIsBusy, applyGpuBid } from '../../shared/gpuOccupancy.js';

// Data Builder uses a quote before submission. Presentation is supplied by its controller.
export async function quoteCreation({ request, serverId, args, signal, ask }) {
 const query = async () => {
  const response = await request('/api/create/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server_id: serverId, args }), signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || 'Failed to query server'), { status: response.status });
  return data;
 };
 const data = await query();
 const occupancy = parseGpuOccupancy(data);
 const cost = Number(data.cost);
 if (occupancyIsBusy(occupancy)) {
  const bid = await ask({ kind: 'occupancy', occupancy, options: { lane: 'product', method: 'advanced_generate', signal, peek: async () => parseGpuOccupancy(await query()) } });
  return { args: applyGpuBid(args, bid, 'product'), creditCost: Number(bid.charge) > 0 ? bid.charge : cost };
 }
 if (!(data.supported === true || data.supported === 'true') || !Number.isFinite(cost) || cost <= 0) throw new Error('This server does not support this request.');
 await ask({ kind: 'cost', message: `This will cost ${cost} credit${cost === 1 ? '' : 's'}.`, primaryLabel: 'Create' });
 return { args, creditCost: cost };
}
