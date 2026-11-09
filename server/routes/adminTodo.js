import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TODO_PATH = process.env.ADMIN_TODO_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../_docs/TODO.json');
const TODO_READ_ONLY = process.env.ADMIN_TODO_READ_ONLY === 'true';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function computePriority(time, impact) {
	if (!Number.isFinite(time) || !Number.isFinite(impact)) return 1;
	const normalizedTime = clamp(time / 100, 0, 1);
	return clamp(Math.round(impact * (1 - normalizedTime ** 2) || 1), 1, 100);
}
function computePriorityRatio(time, impact) {
	if (!Number.isFinite(time) || !Number.isFinite(impact)) return 1;
	return clamp(Math.round(impact / (1 + Math.max(0, time / 100) ** 2) || 1), 1, 100);
}
function computePriorityImpact(_time, impact) {
	return Number.isFinite(impact) ? clamp(Math.round(impact), 1, 100) : 1;
}
function computePriorityCost(time) {
	return Number.isFinite(time) ? clamp(Math.round(time), 1, 100) : 1;
}
function computeProbability(time) {
	return Number.isFinite(time) ? clamp(Math.round(100 - time), 0, 100) : 0;
}
function normalizeDependencies(value) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}
function normalizeItem(item, compute = computePriority) {
	const name = String(item?.name || '').trim();
	const description = String(item?.description || '').trim();
	const cost = Number(item?.cost ?? item?.time);
	const impact = Number(item?.impact);
	const dependsOn = normalizeDependencies(item?.dependsOn).filter((dependency) => dependency !== name);
	return {
		name, description, cost, impact, dependsOn,
		priority: Number.isFinite(cost) && Number.isFinite(impact) ? compute(cost, impact) : 0,
		probability: Number.isFinite(cost) ? computeProbability(cost) : 0,
		starred: Boolean(item?.starred)
	};
}
function applyDependencyPriority(items) {
	const byName = new Map(items.map((item) => [item.name, item]));
	let changed = true;
	for (let pass = 0; changed && pass < Math.max(items.length * 4, 10); pass += 1) {
		changed = false;
		for (const item of items) for (const dependencyName of item.dependsOn || []) {
			const dependency = byName.get(dependencyName);
			if (dependency) {
				const boostedPriority = Math.min(100, item.priority + 1);
				if (boostedPriority > dependency.priority) {
					dependency.priority = boostedPriority;
					changed = true;
				}
			}
		}
	}
}
function dependencyMap(items) {
	return new Map(items.map((item) => [String(item?.name || '').trim(), normalizeDependencies(item?.dependsOn)]));
}
function canReach(from, target, map, visited = new Set()) {
	if (!from || !target) return false;
	if (from === target) return true;
	if (visited.has(from)) return false;
	visited.add(from);
	return (map.get(from) || []).some((dependency) => canReach(dependency, target, map, visited));
}
function wouldCreateCycle(items, name, dependsOn) {
	const map = dependencyMap(items);
	map.set(name, normalizeDependencies(dependsOn).filter((dependency) => dependency !== name));
	return (map.get(name) || []).some((dependency) => canReach(dependency, name, map));
}
async function readItems(mode = 'gated') {
	const compute = mode === 'ratio' ? computePriorityRatio : mode === 'impact' ? computePriorityImpact : mode === 'cost' ? computePriorityCost : computePriority;
	const parsed = JSON.parse(await fs.readFile(TODO_PATH, 'utf8'));
	const items = Array.isArray(parsed) ? parsed.map((item) => normalizeItem(item, compute)) : [];
	applyDependencyPriority(items);
	return items;
}
async function writeItems(items) {
	const normalized = items.map((item, order) => ({ ...normalizeItem(item), order }));
	applyDependencyPriority(normalized);
	normalized.sort((a, b) => b.priority - a.priority || a.order - b.order);
	await fs.writeFile(TODO_PATH, JSON.stringify(normalized.map(({ name, description, cost, impact, dependsOn, starred }) => ({
		name, description, cost, impact, dependsOn, starred: Boolean(starred)
	})), null, 2), 'utf8');
}
function modeFromRequest(raw) {
	if (raw === 'post') return 'ratio';
	if (raw === 'pre') return 'gated';
	return ['ratio', 'impact', 'cost'].includes(raw) ? raw : 'gated';
}
function validPayload(body) {
	const name = String(body?.name || '').trim();
	const description = String(body?.description || '').trim();
	const time = Number(body?.time);
	const impact = Number(body?.impact);
	if (!name || !description) return { error: 'Name and description are required.' };
	if (!Number.isFinite(time) || time < 1 || time > 100) return { error: 'Time must be a number from 1 to 100.' };
	if (!Number.isFinite(impact) || impact < 1 || impact > 100) return { error: 'Impact must be a number from 1 to 100.' };
	return { item: { name, description, cost: time, impact, dependsOn: normalizeDependencies(body?.dependsOn).filter((dependency) => dependency !== name), starred: Boolean(body?.starred) } };
}

export default function createAdminTodoRoutes({ users }) {
	const router = express.Router();
	router.use('/api/todo', (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
	async function isAdmin(req, res) {
		if (!req.auth?.userId) { res.sendStatus(401); return false; }
		const user = await users.byId(req.auth.userId);
		if (user?.role !== 'admin') { res.sendStatus(403); return false; }
		return true;
	}
	const guard = (handler) => async (req, res, next) => {
		try { if (!(await isAdmin(req, res))) return; await handler(req, res); }
		catch (error) { next(error); }
	};
	const all = (items, mode) => {
		const formula = mode === 'ratio' ? 'round(Impact / (1 + (Cost/100)^2)), deps bumped +1'
			: mode === 'impact' ? 'round(Impact), deps bumped +1'
				: mode === 'cost' ? 'round(Cost), deps bumped +1'
					: 'round(Impact * (1 - (Cost/100)^2)), deps bumped +1';
		return { items: items.map((item) => ({ name: item.name, description: item.description, time: item.cost, impact: item.impact, dependsOn: item.dependsOn, priority: item.priority, probability: item.probability, starred: Boolean(item.starred) })), writable: !TODO_READ_ONLY, formula };
	};
	router.get('/api/todo', guard(async (req, res) => {
		const mode = modeFromRequest(String(req.query?.mode || ''));
		const result = all(await readItems(mode), mode);
		const allowedSort = ['name', 'priority', 'time', 'impact'];
		const sortBy = allowedSort.includes(req.query.sort_by) ? req.query.sort_by : 'priority';
		const direction = req.query.sort_dir === 'asc' ? 1 : -1;
		const items = [...result.items].sort((left, right) => {
			if (left.starred !== right.starred) return left.starred ? -1 : 1;
			const a = sortBy === 'name' ? left.name.toLocaleLowerCase() : Number(left[sortBy]);
			const b = sortBy === 'name' ? right.name.toLocaleLowerCase() : Number(right[sortBy]);
			return (a < b ? -1 : a > b ? 1 : 0) * direction;
		});
		const total = items.length;
		const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
		const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
		res.json({ ...result, items: items.slice(offset, offset + limit), total });
	}));
	router.post('/api/todo', guard(async (req, res) => {
		if (TODO_READ_ONLY) return res.status(403).json({ error: 'Todo edits are disabled on this deployment.' });
		const parsed = validPayload(req.body);
		if (parsed.error) return res.status(400).json({ error: parsed.error });
		const items = await readItems();
		const dependsOn = normalizeDependencies(req.body?.dependsOn).filter((dependency) => dependency !== parsed.item.name);
		if (wouldCreateCycle(items, parsed.item.name, dependsOn)) return res.status(400).json({ error: 'Invalid dependency: would create a circular dependency.' });
		items.push({ ...parsed.item, dependsOn, priority: computePriority(parsed.item.cost, parsed.item.impact), probability: computeProbability(parsed.item.cost) });
		await writeItems(items);
		res.json({ ok: true, item: { ...parsed.item, time: parsed.item.cost, priority: computePriority(parsed.item.cost, parsed.item.impact), probability: computeProbability(parsed.item.cost) } });
	}));
	router.put('/api/todo', guard(async (req, res) => {
		if (TODO_READ_ONLY) return res.status(403).json({ error: 'Todo edits are disabled on this deployment.' });
		const originalName = String(req.body?.originalName || '').trim();
		if (!originalName) return res.status(400).json({ error: 'Original name is required.' });
		const parsed = validPayload(req.body);
		if (parsed.error) return res.status(400).json({ error: parsed.error });
		const items = await readItems();
		if (!items.some((item) => item.name === originalName)) return res.status(404).json({ error: 'Todo item not found.' });
		const updated = items.map((item) => {
			if (item.name === originalName) return { ...parsed.item, priority: computePriority(parsed.item.cost, parsed.item.impact), probability: computeProbability(parsed.item.cost) };
			const dependsOn = originalName === parsed.item.name ? item.dependsOn : item.dependsOn.map((dependency) => dependency === originalName ? parsed.item.name : dependency);
			return { ...item, dependsOn: normalizeDependencies(dependsOn).filter((dependency) => dependency !== item.name) };
		});
		if (wouldCreateCycle(updated, parsed.item.name, parsed.item.dependsOn)) return res.status(400).json({ error: 'Invalid dependency: would create a circular dependency.' });
		await writeItems(updated);
		res.json({ ok: true, item: { ...parsed.item, time: parsed.item.cost, priority: computePriority(parsed.item.cost, parsed.item.impact), probability: computeProbability(parsed.item.cost) } });
	}));
	router.patch('/api/todo', guard(async (req, res) => {
		if (TODO_READ_ONLY) return res.status(403).json({ error: 'Todo edits are disabled on this deployment.' });
		const name = String(req.body?.name || '').trim();
		if (!name) return res.status(400).json({ error: 'Name is required.' });
		const items = await readItems();
		const item = items.find((candidate) => candidate.name === name);
		if (!item) return res.status(404).json({ error: 'Todo item not found.' });
		item.starred = Boolean(req.body?.starred);
		await writeItems(items);
		res.json({ ok: true, item: { name: item.name, starred: item.starred } });
	}));
	router.delete('/api/todo', guard(async (req, res) => {
		if (TODO_READ_ONLY) return res.status(403).json({ error: 'Todo edits are disabled on this deployment.' });
		const name = String(req.body?.name || '').trim();
		if (!name) return res.status(400).json({ error: 'Name is required.' });
		const items = await readItems();
		if (!items.some((item) => item.name === name)) return res.status(404).json({ error: 'Todo item not found.' });
		await writeItems(items.filter((item) => item.name !== name));
		res.json({ ok: true });
	}));
	return router;
}
