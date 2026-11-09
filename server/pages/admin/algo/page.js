import { loadAdminDataTable } from '/admin/shared/adminDataTable.js';

const table = document.querySelector('[data-transitions-table]');
const form = document.querySelector('[data-algo-settings]');
const fields = document.querySelector('[data-algo-fields]');
const status = document.querySelector('[data-algo-status]');
const dialog = document.querySelector('[data-transition-dialog]');
const dialogBody = document.querySelector('[data-transition-dialog-body]');
const dialogTitle = document.querySelector('[data-transition-dialog-title]');
const tabs = document.querySelector('admin-tabs');
const settings = [
	['related.recsys_weight', 'Recsys weight'], ['related.semantic_weight', 'Semantic weight'],
	['related.semantic_weight_no_click_next', 'Semantic weight without click-next'], ['related.semantic_distance_max', 'Maximum semantic distance'],
	['related.lineage_weight', 'Lineage weight'], ['related.lineage_min_slots', 'Lineage minimum slots'],
	['related.same_server_method_weight', 'Same server and method weight'], ['related.same_creator_weight', 'Same creator weight'],
	['related.fallback_weight', 'Fallback weight'], ['related.transition_cap_k', 'Transition cap per source'],
	['related.transition_decay_half_life_days', 'Transition decay half-life (days)'], ['related.transition_window_days', 'Transition window (days)'],
	['related.random_slots_per_batch', 'Random slots per batch'], ['related.batch_size', 'Batch size'], ['related.candidate_cap_per_signal', 'Candidate cap per signal']
];
const hints = {
	'related.recsys_weight': 'Recsys contribution when click-next history exists.',
	'related.semantic_weight': 'Vector similarity contribution when click-next history exists; 0 disables it.',
	'related.semantic_weight_no_click_next': 'Semantic contribution when no click-next history exists.',
	'related.semantic_distance_max': 'Maximum cosine distance to include; 0 is identical and 1 is orthogonal.',
	'related.lineage_weight': 'Score for parent and child lineage matches.',
	'related.lineage_min_slots': 'Minimum batch slots reserved for lineage.',
	'related.same_server_method_weight': 'Score for the same provider and method.',
	'related.same_creator_weight': 'Score for creations by the same creator.',
	'related.fallback_weight': 'Score for recent fallback creations.',
	'related.transition_cap_k': 'Maximum destinations retained per source.',
	'related.transition_decay_half_life_days': 'Older click-next transitions receive less weight.',
	'related.transition_window_days': 'Hard age cutoff; zero uses decay only.',
	'related.random_slots_per_batch': 'Random items injected into each batch.',
	'related.batch_size': 'Related items returned per request.',
	'related.candidate_cap_per_signal': 'Maximum candidates considered per signal.'
};
const sectionFor = (key) => key.startsWith('related.recsys') || key.startsWith('related.semantic') ? 'Recsys vs semantic' : key.includes('transition_') ? 'Click-next transitions' : ['related.random_slots_per_batch', 'related.batch_size', 'related.candidate_cap_per_signal'].includes(key) ? 'Random & caps' : 'Signal tuning';
const time = (value) => {
	if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
	const date = new Date(value); const seconds = (date.getTime() - Date.now()) / 1000;
	const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
	const [unit, size] = units.find(([, threshold]) => Math.abs(seconds) >= threshold) || ['second', 1];
	const output = document.createElement('time'); output.dateTime = date.toISOString(); output.title = date.toLocaleString();
	output.textContent = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(seconds / size), unit); return output;
};
function link(id) { const a = document.createElement('a'); a.href = `/creations/${encodeURIComponent(id)}`; a.textContent = String(id ?? '—'); return a; }
async function request(url, options) { const response = await fetch(url, { credentials: 'same-origin', ...options }); const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body; }

try {
	const remembered = sessionStorage.getItem('admin-algo-tab');
	if (['transitions', 'graph', 'settings', 'feed-pins'].includes(remembered)) tabs?.activate?.(remembered, false);
	tabs?.addEventListener('admin-tab-change', (event) => {
		const id = event.detail?.id;
		if (['transitions', 'graph', 'settings', 'feed-pins'].includes(id)) { try { sessionStorage.setItem('admin-algo-tab', id); } catch { /* Ignore storage failures. */ } }
		if (id === 'graph') loadGraphOnce();
	});
} catch { /* Tab persistence is an enhancement; the page remains usable without storage. */ }

function openTransition(row) {
	dialogTitle.textContent = `Click-next · ${row.count ?? 0} clicks`;
	dialogBody.replaceChildren();
	const details = document.createElement('dl'); details.className = 'admin-detail-list';
	for (const [label, value] of [['From creation', row.from_created_image_id], ['To creation', row.to_created_image_id], ['Clicks', row.count], ['Last updated', row.last_updated ? new Date(row.last_updated).toLocaleString() : '—']]) {
		const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd');
		if (label.includes('creation') && value != null) dd.append(link(value)); else dd.textContent = String(value ?? '—');
		details.append(dt, dd);
	}
	dialogBody.append(details); dialog.showModal();
}
document.querySelector('[data-transition-dialog-close]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
loadAdminDataTable(table, {
	fetchUrl: '/api/admin-tools/transitions', itemsKey: 'items', pageSize: 25, defaultSortBy: 'count', defaultSortDir: 'desc',
	ariaLabel: 'Click-next transitions', rowLabel: 'transition details', getRowLabel: (row) => `View transition from ${row.from_created_image_id} to ${row.to_created_image_id}`,
	onRowClick: openTransition, emptyMessage: 'No transition data yet. Click related cards on creation detail to record transitions.',
	columns: [
		{ key: 'from_created_image_id', label: 'From', render: (row) => String(row.from_created_image_id ?? '—') },
		{ key: 'to_created_image_id', label: 'To', render: (row) => String(row.to_created_image_id ?? '—') },
		{ key: 'count', label: 'Clicks', sortKey: 'count' },
		{ key: 'last_updated', label: 'Updated', sortKey: 'last_updated', render: (row) => time(row.last_updated) }
	]
});

try {
	const data = await request('/api/admin-tools/related-settings');
	let section = '';
	for (const [key, label] of settings) {
		const nextSection = sectionFor(key);
		if (nextSection !== section) { section = nextSection; const heading = document.createElement('h2'); heading.className = 'admin-settings-section-title'; heading.textContent = section; fields.append(heading); }
		const wrapper = document.createElement('div'); wrapper.className = 'admin-field';
		const caption = document.createElement('label'); caption.className = 'admin-field__label'; caption.textContent = label; caption.htmlFor = `algo-${key.replaceAll('.', '-')}`;
		const input = document.createElement('input'); input.className = 'admin-input'; input.name = key; input.id = caption.htmlFor; input.type = 'number'; input.step = 'any'; input.value = data[key] ?? '';
		const hint = document.createElement('p'); hint.className = 'admin-detail'; hint.textContent = hints[key]; wrapper.append(caption, input, hint); fields.append(wrapper);
	}
} catch (error) { status.textContent = error.message; status.classList.add('admin-status--error'); }
form.addEventListener('submit', async (event) => {
	event.preventDefault(); status.textContent = 'Saving…'; status.classList.remove('admin-status--error');
	const body = Object.fromEntries(new FormData(form));
	try { await request('/api/admin-tools/related-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); status.textContent = 'Saved.'; }
	catch (error) { status.textContent = error.message; status.classList.add('admin-status--error'); }
});

// Feed pins use the shared admin table and row-detail dialog. Each write submits the full policy document.
const pinsTableHost = document.querySelector('[data-pins-table]');
const pinStatus = document.querySelector('[data-pins-status]');
const pinDialog = document.querySelector('[data-pin-dialog]');
const pinDialogTitle = document.querySelector('[data-pin-dialog-title]');
const pinDialogBody = document.querySelector('[data-pin-dialog-body]');
const defaultsDialog = document.querySelector('[data-pin-defaults-dialog]');
const defaultsBody = document.querySelector('[data-pin-defaults-body]');
const clearExpiredDialog = document.querySelector('[data-clear-expired-dialog]');
const expiredPinList = document.querySelector('[data-expired-pin-list]');
const expiredPinStatus = document.querySelector('[data-expired-pin-status]');
const clearExpiredButton = document.querySelector('[data-clear-expired-submit]');
const clearExpiredLabel = document.querySelector('[data-clear-expired-label]');
const clearExpiredSpinner = document.querySelector('[data-clear-expired-spinner]');
const pinDefaults = { min_index_flat: 3, min_index_slot_pack: 7, after_challenge_offset: 2, respect_challenge: true, show_metadata: true, extra_spacing: true };
let pinDocument = { defaults: { ...pinDefaults }, pins: [] };
let pinTable;
let editingPinId = null;
let creatingPin = false;
const pinDefaultsFields = [
	['min_index_flat','Minimum index (flat feed)','number'], ['min_index_slot_pack','Minimum index (mobile slot-pack)','number'],
	['after_challenge_offset','Offset after challenge card','number'], ['respect_challenge','Respect challenge placement','checkbox'],
	['show_metadata','Show metadata by default','checkbox'], ['extra_spacing','Extra vertical spacing by default','checkbox']
];
function inputField(label, value, type, name) {
	const wrapper = document.createElement('label'); wrapper.className = `admin-field${type === 'checkbox' ? ' admin-field--checkbox' : ''}`; wrapper.append(document.createTextNode(label));
	const input = document.createElement('input'); input.className = 'admin-input'; input.type = type; input.dataset.name = name;
	if (type === 'checkbox') input.checked = value !== false;
	else if (type === 'datetime-local' && value) { const date = new Date(value); const pad = (n) => String(n).padStart(2, '0'); input.value = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
	else input.value = value ?? '';
	wrapper.append(input); return wrapper;
}
function renderDefaultsForm(defaults) {
	defaultsBody.replaceChildren(); const form = document.createElement('form'); form.className = 'admin-form';
	for (const [key,label,type] of pinDefaultsFields) form.append(inputField(label, defaults[key], type, key));
	defaultsBody.append(form);
}
function renderPinForm(pin) {
	pinDialogBody.replaceChildren(); const form = document.createElement('form'); form.className = 'admin-form';
	const pinId = document.createElement('input'); pinId.type = 'hidden'; pinId.dataset.name = 'id'; pinId.value = pin.id || `pin-${pin.created_image_id || ''}`; form.append(pinId);
	const preview = document.createElement('a'); preview.className = 'admin-detail'; preview.href = `/creations/${encodeURIComponent(pin.created_image_id || '')}`; preview.target = '_blank'; preview.rel = 'noopener'; preview.textContent = 'Preview creation'; form.append(preview);
	const config = pin.inject || {};
	for (const [key,label,value,type] of [['created_image_id','Creation ID',pin.created_image_id,'number'],['enabled','Enabled',pin.enabled,'checkbox'],['starts_at','Starts at (optional)',pin.starts_at,'datetime-local'],['until','Expires at',pin.until,'datetime-local'],['show_metadata','Show metadata',pin.show_metadata,'checkbox'],['extra_spacing','Extra vertical spacing',pin.extra_spacing,'checkbox']]) form.append(inputField(label,value,type,key));
	const creationInput = form.querySelector('[data-name="created_image_id"]'); creationInput.addEventListener('input',()=>{preview.href=`/creations/${encodeURIComponent(creationInput.value)}`;});
	const surfaces = document.createElement('fieldset'); surfaces.className='admin-field'; const legend=document.createElement('legend'); legend.textContent='Surfaces'; surfaces.append(legend);
	for(const [value,label] of [['all','All'],['chat','Chat #feed'],['home','Home feed']]) surfaces.append(inputField(label,(pin.surfaces||['all']).includes(value),'checkbox',`surface:${value}`)); form.append(surfaces);
	const slotField=document.createElement('label'); slotField.className='admin-field'; slotField.append(document.createTextNode('Inject placement')); const slot=document.createElement('select'); slot.className='admin-input'; slot.dataset.name='slot';
	for(const [value,label] of [['min_index','Minimum index'],['top','Top of page'],['after_first','After 1st item'],['after_second','After 2nd item'],['after_third','After 3rd item'],['after_fourth','After 4th item'],['after_fifth','After 5th item'],['fixed_index','Fixed index (0-based)']]){const option=document.createElement('option');option.value=value;option.textContent=label;slot.append(option);} slot.value=config.slot||'min_index';slotField.append(slot);form.append(slotField);
	for(const [key,label,fallback] of [['fixed_index','Fixed index',pinDocument.defaults.min_index_flat],['min_index_flat','Minimum index (flat feed)',pinDocument.defaults.min_index_flat],['min_index_slot_pack','Minimum index (mobile slot-pack)',pinDocument.defaults.min_index_slot_pack],['after_challenge_offset','Offset after challenge card',pinDocument.defaults.after_challenge_offset]]) form.append(inputField(label,config[key]??fallback,'number',key));
	form.append(inputField('Respect challenge placement',config.respect_challenge,'checkbox','respect_challenge'));
	pinDialogBody.append(form);
}
function collectPinForm() {
	const form=pinDialogBody.querySelector('form'); const original=pinDocument.pins.find(pin=>Number(pin.created_image_id)===editingPinId)||{}; const output={...original,id:form.querySelector('[data-name="id"]').value,surfaces:[],inject:{...(original.inject||{})}};
	form.querySelectorAll('[data-name]').forEach((input)=>{const name=input.dataset.name;if(name==='id')return;if(name.startsWith('surface:')){if(input.checked)output.surfaces.push(name.slice(8));}else if(name==='slot')output.inject.slot=input.value;else if(['fixed_index','min_index_flat','min_index_slot_pack','after_challenge_offset','respect_challenge'].includes(name))output.inject[name]=input.type==='checkbox'?input.checked:Number(input.value);else if(name==='starts_at'||name==='until')output[name]=input.value?new Date(input.value).toISOString():null;else if(name==='created_image_id')output[name]=Number(input.value);else output[name]=input.type==='checkbox'?input.checked:input.value;});
	if(!output.surfaces.length)output.surfaces=['all']; return output;
}
function collectDefaults() {
	const result={}; defaultsBody.querySelectorAll('[data-name]').forEach(input=>{result[input.dataset.name]=input.type==='checkbox'?input.checked:Number(input.value);}); return result;
}
async function savePinDocument(next, successMessage) {
	pinStatus.textContent='Saving…'; pinStatus.classList.remove('admin-status--error');
	try { pinDocument=await request('/api/admin-tools/feed-editorial-pins',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)}); pinStatus.textContent=successMessage; await pinTable?.refresh(); return true; }
	catch(error){pinStatus.textContent=error.message;pinStatus.classList.add('admin-status--error');return false;}
}
function openPin(row, isNew = false) {
	creatingPin=isNew; editingPinId=isNew?null:Number(row.created_image_id); pinDialogTitle.textContent=isNew?'Add feed pin':`Feed pin · creation ${row.created_image_id}`; renderPinForm(row); pinDialog.showModal();
}
document.querySelector('[data-pin-dialog-close]').addEventListener('click',()=>pinDialog.close());
pinDialog.addEventListener('click',event=>{if(event.target===pinDialog)pinDialog.close();});
document.querySelector('[data-pin-save]').addEventListener('click',async()=>{
	const saved=collectPinForm();
	if(!Number.isFinite(saved.created_image_id)||saved.created_image_id<=0){pinStatus.textContent='Enter a valid creation ID.';pinStatus.classList.add('admin-status--error');return;}
	const pins=[...pinDocument.pins]; const index=pins.findIndex(pin=>Number(pin.created_image_id)===editingPinId);
	if(index>=0)pins[index]=saved;else pins.push(saved);
	if(await savePinDocument({defaults:pinDocument.defaults,pins},'Saved. Feed version bumped.'))pinDialog.close();
});
document.querySelector('[data-pin-remove]').addEventListener('click',async()=>{
	if(creatingPin){pinDialog.close();return;}
	const pins=pinDocument.pins.filter(pin=>Number(pin.created_image_id)!==editingPinId);
	if(await savePinDocument({defaults:pinDocument.defaults,pins},'Pin removed. Feed version bumped.'))pinDialog.close();
});
document.querySelector('[data-open-pin-defaults]').addEventListener('click',()=>{renderDefaultsForm(pinDocument.defaults);defaultsDialog.showModal();});
document.querySelector('[data-pin-defaults-close]').addEventListener('click',()=>defaultsDialog.close());
defaultsDialog.addEventListener('click',event=>{if(event.target===defaultsDialog)defaultsDialog.close();});
document.querySelector('[data-pin-defaults-save]').addEventListener('click',async()=>{if(await savePinDocument({defaults:collectDefaults(),pins:pinDocument.pins},'Defaults saved. Feed version bumped.'))defaultsDialog.close();});
document.querySelector('[data-add-pin]').addEventListener('click',()=>openPin({enabled:true,surfaces:['all'],inject:{slot:'min_index'}},true));
function showExpiredPins() {
	const expired=pinDocument.pins.filter(pin=>pin.until&&Number.isFinite(Date.parse(pin.until))&&Date.parse(pin.until)<Date.now());
	expiredPinList.replaceChildren(); expiredPinStatus.textContent=''; expiredPinStatus.classList.remove('admin-status--error');
	if(!expired.length){const empty=document.createElement('p');empty.className='admin-status';empty.textContent='There are no expired pins.';expiredPinList.append(empty);}
	else {const list=document.createElement('ul');list.className='admin-expired-pin-list';for(const pin of expired){const item=document.createElement('li');const creation=document.createElement('strong');creation.textContent=`Creation ${pin.created_image_id}`;const until=document.createElement('time');until.dateTime=pin.until;until.textContent=`Expired ${new Date(pin.until).toLocaleString()}`;item.append(creation,until);list.append(item);}expiredPinList.append(list);}
	clearExpiredButton.disabled=expired.length===0; clearExpiredButton.dataset.expiredCount=String(expired.length); clearExpiredDialog.showModal();
}
document.querySelector('[data-clear-expired-pins]').addEventListener('click',showExpiredPins);
document.querySelector('[data-clear-expired-close]').addEventListener('click',()=>clearExpiredDialog.close());
clearExpiredDialog.addEventListener('click',event=>{if(event.target===clearExpiredDialog)clearExpiredDialog.close();});
clearExpiredButton.addEventListener('click',async()=>{
	if(clearExpiredButton.disabled)return;
	clearExpiredButton.disabled=true; clearExpiredButton.setAttribute('aria-busy','true'); clearExpiredLabel.hidden=true; clearExpiredSpinner.hidden=false; expiredPinStatus.textContent=''; expiredPinStatus.classList.remove('admin-status--error');
	try {
		const result=await request('/api/admin-tools/feed-editorial-pins/clear-expired',{method:'POST'});
		pinDocument={defaults:result.defaults,pins:result.pins}; await pinTable?.refresh(); clearExpiredDialog.close();
	} catch(error) {
		expiredPinStatus.textContent=error.message; expiredPinStatus.classList.add('admin-status--error');
	} finally {
		clearExpiredButton.disabled=Number(clearExpiredButton.dataset.expiredCount)===0; clearExpiredButton.removeAttribute('aria-busy'); clearExpiredLabel.hidden=false; clearExpiredSpinner.hidden=true;
	}
});
try {
	pinDocument=await request('/api/admin-tools/feed-editorial-pins');
	pinTable=await loadAdminDataTable(pinsTableHost,{fetchUrl:'/api/admin-tools/feed-editorial-pins',itemsKey:'items',pageSize:25,ariaLabel:'Configured feed pins',rowLabel:'feed pin details',getRowLabel:row=>`Edit feed pin for creation ${row.created_image_id}`,onRowClick:row=>openPin(row),defaultSortBy:'created_image_id',defaultSortDir:'desc',emptyMessage:'No pins configured.',columns:[
		{key:'created_image_id',label:'Creation'},
		{key:'enabled',label:'Status',render:row=>row.until&&Date.parse(row.until)<Date.now()?'Expired':row.enabled===false?'Disabled':'Active'},
		{key:'until',label:'Expires',sortKey:'until',render:row=>row.until?time(row.until):'No expiry'}
	]});
} catch(error){pinStatus.textContent=error.message;pinStatus.classList.add('admin-status--error');}

// Native SVG graph explorer: all transition pages are loaded, then the graph is pannable and zoomable.
const graphHost = document.querySelector('[data-transition-graph]');
let graphLoaded = false;
function loadGraphOnce() { if (graphLoaded) return; graphLoaded = true; void renderGraph(); }
const GRAPH_W = 800;
const GRAPH_H = 400;
function applyCircle(nodes, cx, cy, radius) {
	const n = nodes.length;
	nodes.forEach((node, i) => { const angle = (2 * Math.PI * i) / n - Math.PI / 2; node.x = cx + radius * Math.cos(angle); node.y = cy + radius * Math.sin(angle); });
}
function applyForce(nodes, edges, w, h) {
	const centerX=w/2, centerY=h/2, maxRadius=.42*Math.min(w,h), degree=new Map(nodes.map(node=>[node,0]));
	for(const edge of edges){degree.set(edge.from,(degree.get(edge.from)||0)+1);degree.set(edge.to,(degree.get(edge.to)||0)+1);}
	const ranked=[...nodes].sort((a,b)=>(degree.get(b)||0)-(degree.get(a)||0));
	ranked.forEach((node,i)=>{const radius=.18*Math.min(w,h)*i/Math.max(ranked.length-1,1),angle=2*Math.PI*i/Math.max(ranked.length,1)+i*.7;node.x=centerX+radius*Math.cos(angle);node.y=centerY+radius*Math.sin(angle);});
	for(let iteration=0;iteration<80;iteration++){
		for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.1,f=500/(d*d),fx=f*dx/d,fy=f*dy/d;a.x-=fx;a.y-=fy;b.x+=fx;b.y+=fy;}
		for(const edge of edges){const dx=edge.to.x-edge.from.x,dy=edge.to.y-edge.from.y,d=Math.hypot(dx,dy)||.1,f=d*.06*Math.min(edge.count,10),fx=f*dx/d,fy=f*dy/d;edge.from.x+=fx;edge.from.y+=fy;edge.to.x-=fx;edge.to.y-=fy;}
		for(const node of nodes){const weight=.25+.75*(degree.get(node)||0)/Math.max(1,...degree.values()),dx=centerX-node.x,dy=centerY-node.y,d=Math.hypot(dx,dy)||.01,pull=.04*weight*(1+d/100);node.x+=dx/d*Math.min(pull*d,d*.18);node.y+=dy/d*Math.min(pull*d,d*.18);const radius=Math.hypot(node.x-centerX,node.y-centerY);if(radius>maxRadius){node.x=centerX+(node.x-centerX)*maxRadius/radius;node.y=centerY+(node.y-centerY)*maxRadius/radius;}}
	}
}
function applyNet(nodes, edges, width, height) {
	const idealLength=80,springK=.05,repulsionRadius=100,repulsionK=.8,baseDamping=.85,iterations=400,margin=40,cx=width/2,cy=height/2;
	for(const node of nodes){node.x=cx+(Math.random()-.5)*200;node.y=cy+(Math.random()-.5)*200;node.vx=0;node.vy=0;}
	for(let iteration=0;iteration<iterations;iteration++){const cooling=1-iteration/iterations;
		for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.01;if(d<repulsionRadius){const force=repulsionK*(repulsionRadius-d),fx=force*dx/d,fy=force*dy/d;a.vx-=fx*cooling;a.vy-=fy*cooling;b.vx+=fx*cooling;b.vy+=fy*cooling;}}
		for(const edge of edges){const a=edge.from,b=edge.to,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.01,force=springK*(d-idealLength),fx=force*dx/d,fy=force*dy/d;a.vx+=fx*cooling;a.vy+=fy*cooling;b.vx-=fx*cooling;b.vy-=fy*cooling;}
		for(const node of nodes){if(node.x<margin)node.vx+=5*((margin-node.x)/margin)**2;if(width-node.x<margin)node.vx-=5*((margin-(width-node.x))/margin)**2;if(node.y<margin)node.vy+=5*((margin-node.y)/margin)**2;if(height-node.y<margin)node.vy-=5*((margin-(height-node.y))/margin)**2;const proximity=Math.min(node.x,width-node.x,node.y,height-node.y),friction=proximity<margin?.6+.4*(proximity/margin):1;node.vx*=baseDamping*friction;node.vy*=baseDamping*friction;node.x=Math.max(0,Math.min(width,node.x+node.vx));node.y=Math.max(0,Math.min(height,node.y+node.vy));}
	}
}
async function applyGraphLayout(nodes, edges, mode) {
	if(mode==='circular') return applyCircle(nodes,GRAPH_W/2,GRAPH_H/2,160);
	if(mode==='force') return applyForce(nodes,edges,GRAPH_W,GRAPH_H);
	if(mode==='net') return applyNet(nodes,edges,GRAPH_W,GRAPH_H);
	if(mode==='d3') {
		const {forceSimulation,forceLink,forceManyBody,forceCenter,forceCollide,forceRadial}=await import('https://esm.sh/d3-force@3');
		const links=edges.map(e=>({source:e.from,target:e.to,count:e.count}));
		const simulation=forceSimulation(nodes).force('link',forceLink(links).id(n=>n.id).distance(5).strength(.35)).force('charge',forceManyBody().strength(-380)).force('center',forceCenter(GRAPH_W/2,GRAPH_H/2)).force('collide',forceCollide().radius(14).strength(1)).force('radial',forceRadial(.42*Math.min(GRAPH_W,GRAPH_H),GRAPH_W/2,GRAPH_H/2).strength(.12));
		simulation.stop();for(let i=0;i<450;i++)simulation.tick();return;
	}
	const version=`?v=${encodeURIComponent(document.querySelector('meta[name="asset-version"]')?.content?.trim()||'')}`;
	const cytoscapeModule=await import(`https://esm.sh/cytoscape@3${version}`);const cytoscape=cytoscapeModule.default;
	const extensionUrl=mode==='cose-bilkent'?'https://esm.sh/cytoscape-cose-bilkent@4':mode==='fcose'?'https://esm.sh/cytoscape-fcose@2':'https://esm.sh/cytoscape-elk@2';
	const extension=(await import(`${extensionUrl}${version}`)).default;cytoscape.use(extension);
	const cy=cytoscape({headless:true,elements:[...nodes.map(n=>({data:{id:String(n.id)}})),...edges.map((e,i)=>({data:{id:`e${i}`,source:String(e.from.id),target:String(e.to.id)}}))]});
	const options=mode==='cose-bilkent'?{name:'cose-bilkent',animate:false,nodeRepulsion:10000,idealEdgeLength:80,quality:'default'}:mode==='fcose'?{name:'fcose',animate:false,packComponents:false,nodeRepulsion:10000,idealEdgeLength:()=>80,nodeSeparation:75,quality:'proof',numIter:6000,gravity:.005,gravityRange:1}:{name:'elk',animate:false,elk:{algorithm:'disco'}};
	await new Promise((resolve,reject)=>{const layout=cy.layout(options);const timeout=setTimeout(()=>reject(new Error(`${mode} layout timed out`)),30000);layout.on('layoutstop',()=>{clearTimeout(timeout);resolve();});try{layout.run();}catch(error){clearTimeout(timeout);reject(error);}});
	for(const node of nodes){const position=cy.getElementById(String(node.id)).position();node.x=position.x;node.y=position.y;}
	if(mode==='fcose'&&nodes.length){const degrees=new Map(nodes.map(n=>[n.id,0]));for(const edge of edges){degrees.set(edge.from.id,(degrees.get(edge.from.id)||0)+1);degrees.set(edge.to.id,(degrees.get(edge.to.id)||0)+1);}const max=Math.max(1,...degrees.values()),cx=nodes.reduce((s,n)=>s+n.x,0)/nodes.length,cy0=nodes.reduce((s,n)=>s+n.y,0)/nodes.length;for(const n of nodes){const t=(degrees.get(n.id)||0)/max,scale=.45+(1-t)*(1.75-.45);n.x=cx+(n.x-cx)*scale;n.y=cy0+(n.y-cy0)*scale;}}
}
async function renderGraph() {
	graphHost.replaceChildren(Object.assign(document.createElement('p'), { className: 'admin-status admin-status--loading', textContent: 'Loading graph…' }));
	try {
		const all=[]; for(let offset=0;;offset+=100){const page=await request(`/api/admin-tools/transitions?limit=100&offset=${offset}&sort_by=count&sort_dir=desc`); all.push(...(page.items||[])); if(all.length>=Number(page.total||0)||!(page.items||[]).length)break;}
		if(!all.length){graphHost.replaceChildren(Object.assign(document.createElement('p'),{className:'admin-status',textContent:'No transition data yet.'}));return;}
		const ids=[...new Set(all.flatMap(row=>[Number(row.from_created_image_id),Number(row.to_created_image_id)]).filter(Number.isFinite))];
		const nodes=ids.map((id,i)=>({id,x:400+Math.cos(i/ids.length*Math.PI*2)*170,y:250+Math.sin(i/ids.length*Math.PI*2)*170})); const byId=new Map(nodes.map(node=>[node.id,node]));
		const edges=all.map(row=>({from:byId.get(Number(row.from_created_image_id)),to:byId.get(Number(row.to_created_image_id)),count:Number(row.count)||1})).filter(edge=>edge.from&&edge.to);
		const toolbar=document.createElement('div');toolbar.className='admin-actions';
		const layoutLabel=document.createElement('label');layoutLabel.className='admin-field__label';layoutLabel.textContent='Layout ';
		const layoutSelect=document.createElement('select');layoutSelect.className='admin-input';
		for(const [value,label] of [['force','Force-directed'],['d3','D3 force'],['cose-bilkent','CoSE-Bilkent'],['fcose','fCoSE'],['elk','ELK (disco)'],['net','ApplyNetLayout'],['circular','Circular']]){const option=document.createElement('option');option.value=value;option.textContent=label;layoutSelect.append(option);}
		layoutSelect.value='d3';layoutLabel.append(layoutSelect);toolbar.append(layoutLabel);
		const zoomOut=document.createElement('button');zoomOut.type='button';zoomOut.className='admin-button';zoomOut.textContent='−';zoomOut.setAttribute('aria-label','Zoom out');const zoomIn=document.createElement('button');zoomIn.type='button';zoomIn.className='admin-button';zoomIn.textContent='+';zoomIn.setAttribute('aria-label','Zoom in');const reset=document.createElement('button');reset.type='button';reset.className='admin-button';reset.textContent='Reset view';toolbar.append(zoomOut,zoomIn,reset);
		const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 800 400');svg.setAttribute('role','img');svg.setAttribute('aria-label','Click-next transitions graph');svg.style.cssText='width:100%;aspect-ratio:1;display:block;border:1px solid var(--admin-border);border-radius:.6rem;touch-action:none;background:Canvas';
		let box={x:0,y:0,w:800,h:400};let initialBox={...box};const apply=()=>svg.setAttribute('viewBox',`${box.x} ${box.y} ${box.w} ${box.h}`);
		async function paint(mode){layoutSelect.disabled=true;try{await applyGraphLayout(nodes,edges,mode);const xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y),minX=Math.min(...xs)-50,minY=Math.min(...ys)-50,maxX=Math.max(...xs)+50,maxY=Math.max(...ys)+50;initialBox={x:minX,y:minY,w:Math.max(1,maxX-minX),h:Math.max(1,maxY-minY)};box={...initialBox};svg.replaceChildren();for(const edge of edges){const line=document.createElementNS(svg.namespaceURI,'line');line.setAttribute('x1',edge.from.x);line.setAttribute('y1',edge.from.y);line.setAttribute('x2',edge.to.x);line.setAttribute('y2',edge.to.y);line.setAttribute('stroke','currentColor');line.setAttribute('stroke-opacity','.65');line.setAttribute('stroke-width',String(Math.max(.5,Math.min(4,.5+edge.count*.25))));svg.append(line);}for(const node of nodes){const anchor=document.createElementNS(svg.namespaceURI,'a');anchor.setAttribute('href',`/creations/${node.id}`);const circle=document.createElementNS(svg.namespaceURI,'circle');circle.setAttribute('cx',node.x);circle.setAttribute('cy',node.y);circle.setAttribute('r','2');circle.setAttribute('fill','var(--admin-accent, #667eea)');anchor.append(circle);svg.append(anchor);}apply();graphHost.querySelector('[data-graph-error]')?.remove();}finally{layoutSelect.disabled=false;}}
		await paint(layoutSelect.value);layoutSelect.addEventListener('change',()=>void paint(layoutSelect.value).catch(error=>{const message=document.createElement('p');message.dataset.graphError='';message.className='admin-status admin-status--error';message.textContent=`Could not load ${layoutSelect.selectedOptions[0]?.textContent} layout: ${error.message}`;graphHost.querySelector('[data-graph-error]')?.remove();graphHost.prepend(message);}));
		const zoom=(factor)=>{const cx=box.x+box.w/2,cy=box.y+box.h/2;box={x:cx-box.w*factor/2,y:cy-box.h*factor/2,w:box.w*factor,h:box.h*factor};apply();};zoomIn.addEventListener('click',()=>zoom(.9));zoomOut.addEventListener('click',()=>zoom(1/.9));reset.addEventListener('click',()=>{box={...initialBox};apply();});let drag=null;svg.addEventListener('pointerdown',event=>{if(event.target.closest('a'))return;drag={x:event.clientX,y:event.clientY,box:{...box}};svg.setPointerCapture(event.pointerId);});svg.addEventListener('pointermove',event=>{if(!drag)return;const rect=svg.getBoundingClientRect();box={...drag.box,x:drag.box.x-(event.clientX-drag.x)*drag.box.w/rect.width,y:drag.box.y-(event.clientY-drag.y)*drag.box.h/rect.height};apply();});svg.addEventListener('pointerup',()=>{drag=null;});svg.addEventListener('pointercancel',()=>{drag=null;});graphHost.replaceChildren(toolbar,svg);
	} catch(error){graphHost.replaceChildren(Object.assign(document.createElement('p'),{className:'admin-status admin-status--error',textContent:error.message}));}
}
if (tabs?.getAttribute('active') === 'graph') loadGraphOnce();
