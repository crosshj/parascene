import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const settingsPath = join(root, 'settings.json');
const modelfilePath = join(root, 'Modelfile');
const publicPath = join(root, 'public');
const defaultHost = 'http://Roosters-Mac-Mini.local:11434';
const appModel = 'parascene-gemma';
const ollamaHost = normalizeHost(process.env.OLLAMA_HOST || defaultHost);
const port = Number(process.env.PORT || 4321);
const settings = await loadSettings();
let activeModel = process.env.OLLAMA_MODEL || settings.model || null;
let readyModel = null;

function log(message, details = '') {
  console.log(`[${new Date().toISOString()}] ${message}${details ? ` — ${details}` : ''}`);
}

async function loadSettings() {
  try { return JSON.parse(await readFile(settingsPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

async function saveSettings() {
  await writeFile(settingsPath, `${JSON.stringify({
    host: ollamaHost,
    model: activeModel || '',
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || settings.keepAlive || '10m',
  }, null, 2)}\n`);
}

function normalizeHost(value) {
  const url = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  return url.replace(/\/$/, '');
}

async function ollama(path, options = {}) {
  let response;
  try { response = await fetch(`${ollamaHost}${path}`, options); }
  catch (error) { throw new Error(`Could not reach Ollama at ${ollamaHost}: ${error.message}`); }
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  return response;
}

async function getModels() {
  const response = await ollama('/api/tags');
  return (await response.json()).models || [];
}

async function chooseModel() {
  if (activeModel) return activeModel;
  const models = await getModels();
  if (!models.length) throw new Error('No models installed on Ollama.');
  activeModel = models[0].name;
  await saveSettings();
  return activeModel;
}

async function ensureReady(model = activeModel) {
  const selected = model || await chooseModel();
  if (readyModel === selected) return selected;
  log('Loading model', `${selected} (keep-alive: ${process.env.OLLAMA_KEEP_ALIVE || settings.keepAlive || '10m'})`);
  const response = await ollama('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: selected,
      prompt: '',
      stream: false,
      keep_alive: process.env.OLLAMA_KEEP_ALIVE || settings.keepAlive || '10m',
    }),
  });
  await response.json();
  readyModel = selected;
  log('Model ready', selected);
  return selected;
}

function jsonResponse(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || '{}');
}

async function readModelDefinition() {
  const source = await readFile(modelfilePath, 'utf8');
  const from = source.match(/^FROM\s+(.+)$/m)?.[1]?.trim();
  const system = source.match(/SYSTEM\s+"""([\s\S]*?)"""/)?.[1]?.trim();
  const parameters = {};
  for (const match of source.matchAll(/^PARAMETER\s+(\S+)\s+(.+)$/gm)) {
    const value = match[2].trim().replace(/^"(.*)"$/, '$1');
    parameters[match[1]] = Number.isNaN(Number(value)) ? value : Number(value);
  }
  if (!from || !system) throw new Error('Could not read FROM and SYSTEM from ollama-client/Modelfile.');
  return { model: appModel, from, system, parameters };
}

async function showModel(model) {
  const response = await fetch(`${ollamaHost}/api/show`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  return response.json();
}

function parametersFromOllama(value) {
  const parameters = {};
  for (const line of String(value || '').split('\n')) {
    const match = line.trim().match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    const raw = match[2].replace(/^"(.*)"$/, '$1');
    parameters[match[1]] = Number.isNaN(Number(raw)) ? raw : Number(raw);
  }
  return parameters;
}

function fromLine(modelfile) {
  return String(modelfile || '').match(/^\s*FROM\s+(.+)$/m)?.[1]?.trim() || '';
}

async function createRemoteModel(definition, report = (message) => log('Model creation', message)) {
  const upstream = await ollama('/api/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(definition),
  });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      report(event.status || event.error || JSON.stringify(event));
      if (event.error) throw new Error(event.error);
    }
    if (done) break;
  }
}

async function reconcileAppModel() {
  const definition = await readModelDefinition();
  const current = await showModel(definition.model);
  const base = await showModel(definition.from);
  const currentParameters = parametersFromOllama(current?.parameters);
  const parametersMatch = Object.entries(definition.parameters).every(([key, value]) => currentParameters[key] === value);
  const sameDefinition = current
    && current.system?.trim() === definition.system.trim()
    && parametersMatch
    && fromLine(current.modelfile) === fromLine(base?.modelfile);

  if (sameDefinition) {
    log('Customized model is current', definition.model);
  } else {
    if (current) {
      log('Customized model is out of date', `${definition.model}; deleting it`);
      await ollama('/api/delete', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: definition.model }),
      });
    } else {
      log('Customized model is missing', definition.model);
    }
    log('Creating customized model', `${definition.model} from ${definition.from}`);
    await createRemoteModel(definition);
  }
  activeModel = definition.model;
  readyModel = null;
  await saveSettings();
}

function sendEvent(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

async function chat(response, input) {
  const model = input.model || await chooseModel();
  await ensureReady(model);
  activeModel = model;
  await saveSettings();
  const messages = input.messages || [];
  const latest = messages[messages.length - 1];
  log('Chat request', `${model}, ${latest?.content?.length || 0} prompt characters${latest?.images?.length ? `, ${latest.images.length} image(s)` : ''}`);
  const upstream = await ollama('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, options: { temperature: 0 } }),
  });
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line);
      if (chunk.message?.content) sendEvent(response, { type: 'delta', content: chunk.message.content });
      if (chunk.done) {
        log('Model response complete', `${model}; done_reason=${chunk.done_reason || 'unknown'}`);
        sendEvent(response, { type: 'done' });
      }
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const chunk = JSON.parse(buffer);
    if (chunk.message?.content) sendEvent(response, { type: 'delta', content: chunk.message.content });
  }
  log('Chat stream complete', model);
  response.end();
}

async function serve(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/status') {
      log('Status check');
      await reconciliation;
      const version = await (await ollama('/api/version')).json();
      const models = await getModels();
      const model = await ensureReady(activeModel || models[0]?.name);
      jsonResponse(response, 200, { host: ollamaHost, version: version.version, model, models: models.map((item) => item.name) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      log('Browser connected for chat');
      await chat(response, await readBody(request));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/settings') {
      const input = await readBody(request);
      if (typeof input.model === 'string' && input.model) activeModel = input.model;
      await saveSettings();
      jsonResponse(response, 200, { model: activeModel });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/model-info') {
      const model = url.searchParams.get('model') || await chooseModel();
      log('Model details requested', model);
      const upstream = await ollama('/api/show', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      jsonResponse(response, 200, await upstream.json());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/create-model') {
      const definition = await readModelDefinition();
      log('Creating customized model', `${definition.model} from ${definition.from}`);
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      await createRemoteModel(definition, (message) => { log('Model creation', message); sendEvent(response, { type: message === 'success' ? 'done' : 'status', message }); });
      activeModel = definition.model;
      readyModel = null;
      await saveSettings();
      response.end();
      return;
    }
    if (request.method === 'GET') {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (file.includes('..') || file.includes('/')) return jsonResponse(response, 404, { error: 'Not found' });
      const content = await readFile(join(publicPath, file));
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
      response.end(content);
      return;
    }
    jsonResponse(response, 404, { error: 'Not found' });
  } catch (error) {
    log('Error', error.message);
    if (!response.headersSent) jsonResponse(response, 500, { error: error.message });
    else { sendEvent(response, { type: 'error', error: error.message }); response.end(); }
  }
}

await mkdir(publicPath, { recursive: true });
const reconciliation = reconcileAppModel().catch((error) => {
  log('Startup model reconciliation failed', error.message);
  throw error;
});
createServer((request, response) => serve(request, response)).listen(port, '127.0.0.1', () => {
  log('Ollama web app started', `http://127.0.0.1:${port}`);
  log('Ollama server configured', ollamaHost);
});
