/**
 * Dev-console helper: window.gen for starting authenticated creations.
 * Install via installConsoleGen() from common app init.
 */

const DEFAULT_SERVER_ID = 1;
const DEFAULT_METHOD = 'replicate';
const DEFAULT_MODEL = 'xai/grok-imagine-image';

const HELP = `gen — start a creation from the console (must be signed in)

  gen\`a really cool image of a pig on a skateboard doing tricks\`
  gen("a really cool image of a pig on a skateboard doing tricks", {})
  gen()  // this help

Defaults
  serverId: ${DEFAULT_SERVER_ID}
  method:   "${DEFAULT_METHOD}"
  model:    "${DEFAULT_MODEL}"

Options (2nd arg)
  model            string   args.model
  aspectRatio      string   args.aspect_ratio (e.g. "1:1", "9:16")
  serverId         number   top-level server_id
  method           string   top-level method
  styleKey         string   style_key
  hydrateMentions  boolean  hydrate_mentions
  mutateOfId       number   mutate_of_id
  groupId          number   group_id
  parentIds        number[] mutate_parent_ids
  imageUrl         string   args.image_url
  inputImages      string[] args.input_images
  args             object   merged into args (overrides prompt/model last)
  open             boolean  open /creations/:id in this tab (default false)

Returns Promise<{ id, status, credits_remaining, href, ... }>`;

function isTaggedTemplate(strings) {
	return Array.isArray(strings) && Object.prototype.hasOwnProperty.call(strings, 'raw');
}

function generateCreationToken() {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 10);
	return `crt_${ts}_${rand}`;
}

function promptFromTaggedTemplate(strings, values) {
	let out = '';
	for (let i = 0; i < strings.length; i++) {
		out += strings[i];
		if (i < values.length) out += values[i] == null ? '' : String(values[i]);
	}
	return out;
}

function showHelp() {
	console.log(HELP);
	return HELP;
}

/**
 * @param {string} promptText
 * @param {Record<string, unknown>} [options]
 */
async function runGen(promptText, options = {}) {
	const prompt = String(promptText || '').trim();
	if (!prompt) {
		throw new Error('gen: prompt is required. Call gen() for help.');
	}

	const opts = options && typeof options === 'object' ? options : {};
	const serverId = Number(opts.serverId ?? DEFAULT_SERVER_ID);
	const method = String(opts.method ?? DEFAULT_METHOD).trim() || DEFAULT_METHOD;
	const model =
		typeof opts.model === 'string' && opts.model.trim()
			? opts.model.trim()
			: DEFAULT_MODEL;

	const args = {
		prompt,
		model,
		...(typeof opts.aspectRatio === 'string' && opts.aspectRatio.trim()
			? { aspect_ratio: opts.aspectRatio.trim() }
			: {}),
		...(typeof opts.imageUrl === 'string' && opts.imageUrl.trim()
			? { image_url: opts.imageUrl.trim() }
			: {}),
		...(Array.isArray(opts.inputImages) && opts.inputImages.length
			? { input_images: opts.inputImages.map((u) => String(u)).filter(Boolean) }
			: {}),
		...(opts.args && typeof opts.args === 'object' ? opts.args : {}),
	};
	// Keep the caller's prompt authoritative unless they overrode via args.prompt.
	if (typeof args.prompt !== 'string' || !String(args.prompt).trim()) {
		args.prompt = prompt;
	}

	const body = {
		server_id: serverId,
		method,
		args,
		creation_token: generateCreationToken(),
		...(typeof opts.styleKey === 'string' && opts.styleKey.trim()
			? { style_key: opts.styleKey.trim() }
			: {}),
		...(typeof opts.hydrateMentions === 'boolean'
			? { hydrate_mentions: opts.hydrateMentions }
			: {}),
		...(Number.isFinite(Number(opts.mutateOfId)) && Number(opts.mutateOfId) > 0
			? { mutate_of_id: Number(opts.mutateOfId) }
			: {}),
		...(Number.isFinite(Number(opts.groupId)) && Number(opts.groupId) > 0
			? { group_id: Number(opts.groupId) }
			: {}),
		...(Array.isArray(opts.parentIds) && opts.parentIds.length
			? {
					mutate_parent_ids: opts.parentIds
						.map((n) => Number(n))
						.filter((n) => Number.isFinite(n) && n > 0),
				}
			: {}),
	};

	console.log('gen: starting…', { prompt: args.prompt, model: args.model, serverId, method });

	const res = await fetch('/api/create', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const msg = data?.error || data?.message || `gen failed (${res.status})`;
		console.error('gen:', msg, data);
		throw new Error(msg);
	}

	const id = Number(data?.id);
	if (!Number.isFinite(id) || id <= 0) {
		throw new Error('gen: started but no creation id returned');
	}

	const href = `/creations/${id}`;
	const result = { ...data, id, href };
	console.log(`gen: started #${id}`, result);
	console.log(`gen: ${window.location.origin}${href}`);

	if (opts.open === true) {
		window.location.href = href;
	}

	return result;
}

/**
 * @param {TemplateStringsArray | string | undefined} first
 * @param {...unknown} rest
 */
function gen(first, ...rest) {
	if (arguments.length === 0) {
		return showHelp();
	}

	if (isTaggedTemplate(first)) {
		const prompt = promptFromTaggedTemplate(first, rest);
		return runGen(prompt, {});
	}

	if (typeof first === 'string') {
		const options = rest[0] && typeof rest[0] === 'object' ? rest[0] : {};
		return runGen(first, options);
	}

	return showHelp();
}

export function installConsoleGen() {
	if (typeof window === 'undefined') return;
	window.gen = gen;
}
