let formatRelativeTime;
let buildProfilePath;
let loadAdminDataTable;

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

let _depsPromise;
async function loadDeps() {
	if (_depsPromise) return _depsPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_depsPromise = (async () => {
		const datetimeMod = await import(`../../shared/datetime.js${qs}`);
		formatRelativeTime = datetimeMod.formatRelativeTime;

		const profileLinksMod = await import(`../../shared/profileLinks.js${qs}`);
		buildProfilePath = profileLinksMod.buildProfilePath;

		const adminDataTableMod = await import(`../../shared/adminDataTable.js${qs}`);
		loadAdminDataTable = adminDataTableMod.loadAdminDataTable;
	})();
	return _depsPromise;
}

const html = String.raw;

function escapeHtml(text) {
	const s = String(text ?? '');
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function copyTextToClipboard(text) {
	const str = String(text ?? '');
	if (navigator?.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(str);
			return;
		} catch {
			// Fall back below.
		}
	}

	const textarea = document.createElement('textarea');
	textarea.value = str;
	textarea.setAttribute('readonly', 'true');
	textarea.style.position = 'fixed';
	textarea.style.top = '-1000px';
	textarea.style.left = '-1000px';
	document.body.appendChild(textarea);
	textarea.select();
	textarea.setSelectionRange(0, textarea.value.length);
	const ok = document.execCommand('copy');
	document.body.removeChild(textarea);
	if (!ok) throw new Error('Copy to clipboard failed.');
}

function truncateCid(cid, maxLen = 20) {
	const s = String(cid || '').trim();
	if (s.length <= maxLen) return s;
	return s.slice(0, 8) + '…' + s.slice(-8);
}

function formatLocalDateTime(value) {
	if (!value) return '—';
	const d = typeof value === 'string' ? new Date(value) : value;
	if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
	const pad = (n) => (n < 10 ? '0' + n : String(n));
	const y = d.getFullYear();
	const m = d.getMonth() + 1;
	const day = d.getDate();
	const h = d.getHours();
	const min = d.getMinutes();
	return `${y}-${pad(m)}-${pad(day)} ${pad(h)}:${pad(min)}`;
}

function truncateStr(s, maxLen = 40) {
	const str = typeof s === 'string' ? s.trim() : '';
	if (!str) return '—';
	return str.length <= maxLen ? str : str.slice(0, maxLen) + '…';
}

const ANALYTICS_TAB_IDS = ['share', 'anonymous', 'blog'];

class AppRouteAnalytics extends HTMLElement {
	async connectedCallback() {
		await loadDeps();
		this._selectedAnonCid = null;
		this._anonDataLoaded = false;
		this._shareDataLoaded = false;
		this._shareExportInFlight = false;
		this._anonExportInFlight = false;
		this._blogDataLoaded = false;
		this.innerHTML = html`
			<h3>Analytics</h3>
			<app-tabs>
				<tab data-id="share" label="Share" default>
					<div class="share-tab-content" data-share-tab-content>
						<div class="users-export-bar" data-share-export-bar>
							<button type="button" class="btn-secondary" data-share-export-copy>
								Copy share export
							</button>
							<div class="users-export-status" data-share-export-status aria-live="polite"></div>
						</div>
						<div class="share-table-container" data-share-table-container>
							<div class="route-empty route-loading">
								<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
							</div>
						</div>
					</div>
				</tab>
				<tab data-id="anonymous" label="Try flow">
					<div class="anon-tab-content" data-anon-tab-content>
						<div class="users-export-bar users-export-bar-anon" data-anon-export-bar>
							<button type="button" class="btn-secondary" data-anon-export-summary>
								Copy anon summary
							</button>
							<button type="button" class="btn-secondary" data-anon-export-expanded>
								Copy anon requests
							</button>
							<div class="users-export-status" data-anon-export-status aria-live="polite"></div>
						</div>
						<div class="anon-table-container" data-anon-table-container>
							<div class="route-empty route-loading">
								<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
							</div>
						</div>
					</div>
				</tab>
				<tab data-id="blog" label="Blog">
					<div class="blog-analytics-tab" data-blog-analytics-root>
						<div class="route-empty route-loading">
							<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
						</div>
					</div>
				</tab>
			</app-tabs>
			<div class="publish-modal-overlay" data-anon-detail-modal role="dialog" aria-modal="true"
				aria-labelledby="anon-detail-modal-title">
				<div class="publish-modal anon-detail-modal">
					<header class="publish-modal-header">
						<h3 id="anon-detail-modal-title" class="anon-detail-modal-title" data-anon-detail-title>Requests</h3>
						<button type="button" class="publish-modal-close" data-anon-detail-close aria-label="Close">✕</button>
					</header>
					<div class="publish-modal-body anon-detail-modal-body">
						<div class="anon-detail-requests" data-anon-detail-requests></div>
					</div>
				</div>
			</div>
		`;
		this._tabsEl = this.querySelector('app-tabs');
		this._tabsEl?.addEventListener('tab-change', (e) => {
			if (e.detail?.id) this._activeTabId = e.detail.id;
			if (e.detail?.id === 'anonymous' && !this._anonDataLoaded) {
				this.loadAnonCids();
			}
			if (e.detail?.id === 'share' && !this._shareDataLoaded) {
				this.loadShareViews();
			}
		});
		this.setupAnalyticsTabHash();
		this._anonModalOverlay = this.querySelector('[data-anon-detail-modal]');
		this._anonModalOverlay?.addEventListener('click', (e) => {
			if (e.target === this._anonModalOverlay) this.closeAnonDetailModal();
		});
		this.querySelector('[data-anon-detail-close]')?.addEventListener('click', () => this.closeAnonDetailModal());
		this._boundAnonModalEscape = (e) => {
			if (e.key === 'Escape' && this._anonModalOverlay?.classList.contains('open')) {
				this.closeAnonDetailModal();
			}
		};
		document.addEventListener('keydown', this._boundAnonModalEscape);

		const shareExportBtn = this.querySelector('[data-share-export-copy]');
		const shareExportStatus = this.querySelector('[data-share-export-status]');
		if (shareExportBtn && !this._shareExportBound) {
			this._shareExportBound = true;
			shareExportBtn.addEventListener('click', async () => {
				await this.exportShareViewsForChatGPT({ statusEl: shareExportStatus });
			});
		}

		const anonSummaryBtn = this.querySelector('[data-anon-export-summary]');
		const anonExpandedBtn = this.querySelector('[data-anon-export-expanded]');
		const anonExportStatus = this.querySelector('[data-anon-export-status]');
		if ((anonSummaryBtn || anonExpandedBtn) && !this._anonExportBound) {
			this._anonExportBound = true;
			anonSummaryBtn?.addEventListener('click', async () => {
				await this.exportAnonUsersForChatGPT({ mode: 'summary', statusEl: anonExportStatus });
			});
			anonExpandedBtn?.addEventListener('click', async () => {
				await this.exportAnonUsersForChatGPT({ mode: 'expanded', statusEl: anonExportStatus });
			});
		}
	}

	disconnectedCallback() {
		if (this._boundAnonModalEscape) {
			document.removeEventListener('keydown', this._boundAnonModalEscape);
		}
		if (this._analyticsTabHashCleanup) this._analyticsTabHashCleanup();
	}

	setupAnalyticsTabHash() {
		const isOnAnalyticsRoute = () => {
			const path = window.location.pathname || '';
			return path === '/analytics' || path.startsWith('/analytics/');
		};

		const syncTabFromHash = () => {
			if (!isOnAnalyticsRoute()) return;
			const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
			const id = hash && ANALYTICS_TAB_IDS.includes(hash) ? hash : 'share';
			this._activeTabId = id;
			const tabs = this._tabsEl || this.querySelector('app-tabs');
			if (tabs && typeof tabs.setActiveTab === 'function') {
				tabs.setActiveTab(id, { focus: false });
			}
			if (id === 'anonymous' && !this._anonDataLoaded) {
				this.loadAnonCids();
			}
			if (id === 'share' && !this._shareDataLoaded) {
				this.loadShareViews();
			}
			if (id === 'blog' && !this._blogDataLoaded) {
				this.loadBlogAnalytics();
			}
		};

		const onRouteChange = (e) => {
			if (e.detail?.route === 'analytics') syncTabFromHash();
		};

		const onHashChange = () => syncTabFromHash();

		setTimeout(() => {
			if (isOnAnalyticsRoute()) syncTabFromHash();
			else this._activeTabId = 'share';
		}, 0);

		document.addEventListener('route-change', onRouteChange);
		window.addEventListener('hashchange', onHashChange);

		if (this._tabsEl) {
			this._tabsEl.addEventListener('tab-change', (e) => {
				const id = e.detail?.id;
				if (!id) return;
				if (!isOnAnalyticsRoute()) return;
				const newHash = `#${id}`;
				if (window.location.hash !== newHash) {
					const search = window.location.search || '';
					window.history.replaceState(null, '', `/analytics${search}${newHash}`);
				}
			});
		}

		this._analyticsTabHashCleanup = () => {
			document.removeEventListener('route-change', onRouteChange);
			window.removeEventListener('hashchange', onHashChange);
		};
	}

	closeAnonDetailModal() {
		this._selectedAnonCid = null;
		if (this._anonModalOverlay) this._anonModalOverlay.classList.remove('open');
		document.body.classList.remove('modal-open');
	}

	showAnonDetail(cid) {
		this._selectedAnonCid = cid;
		const titleEl = this.querySelector('[data-anon-detail-title]');
		const requestsEl = this.querySelector('[data-anon-detail-requests]');
		if (titleEl) titleEl.textContent = `Requests for ${truncateCid(cid)}`;
		if (requestsEl) {
			requestsEl.innerHTML = '<div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>';
		}
		if (this._anonModalOverlay) {
			this._anonModalOverlay.classList.add('open');
			document.body.classList.add('modal-open');
		}
		this.loadAnonDetail(cid);
	}

	async loadAnonCids() {
		const container = this.querySelector('[data-anon-table-container]');
		if (!container) return;
		try {
			this._anonDataLoaded = true;
			await loadAdminDataTable(container, {
				fetchUrl: '/admin/anonymous-users',
				responseItemsKey: 'anonCids',
				columns: [
					{
						key: 'prsn_cid',
						label: 'Client Id',
						sortKey: 'prsn_cid',
						className: 'anon-table-col-prsn-cid',
						render: (row) => {
							const pc = row.prsn_cid && String(row.prsn_cid).trim();
							return pc ? escapeHtml(truncateCid(pc, 18)) : '—';
						}
					},
					{
						key: 'anon_cid',
						label: 'Anon Id',
						sortKey: 'anon_cid',
						className: 'anon-table-col-cid',
						render: (row) => escapeHtml(truncateCid(row.anon_cid))
					},
					{
						key: 'from_share',
						label: 'Source',
						className: 'anon-table-col-source',
						render: (row) => {
							if (typeof row.source === 'string' && row.source.trim()) {
								return escapeHtml(row.source.trim());
							}
							return row.from_share ? 'share' : '';
						}
					},
					{
						key: 'last_request_at',
						label: 'Date',
						sortKey: 'last_request_at',
						className: 'anon-table-col-dates',
						render: (row) => {
							const first = formatLocalDateTime(row.first_request_at);
							const last = formatLocalDateTime(row.last_request_at);
							return `<div class="anon-table-dates-cell"><span class="anon-table-date-line"><span class="anon-table-date-label">Last</span> ${escapeHtml(last)}</span><span class="anon-table-date-line"><span class="anon-table-date-label">First</span> ${escapeHtml(first)}</span></div>`;
						}
					},
					{ key: 'request_count', label: 'Count', sortKey: 'request_count', className: 'anon-table-col-count' },
					{
						key: 'user_agent',
						label: 'User agent',
						className: 'anon-table-col-user-agent',
						render: (row) => escapeHtml(truncateStr(row.user_agent ?? '', 60))
					},
					{
						key: 'ip',
						label: 'IP',
						className: 'anon-table-col-ip',
						render: (row) => {
							const ip = row.ip ?? '';
							const src = row.ip_source ?? '';
							const ipStr = escapeHtml(truncateStr(ip, 45));
							if (!ipStr) return '—';
							if (src) {
								return `${ipStr} <span class="share-table-ip-source" title="IP from header: ${escapeHtml(src)}">${escapeHtml(src)}</span>`;
							}
							return ipStr;
						}
					},
					{
						key: 'location',
						label: 'Location',
						className: 'anon-table-col-location',
						render: (row) => {
							const parts = [row.city, row.region, row.country].filter(Boolean);
							return parts.length ? escapeHtml(parts.join(', ')) : '—';
						}
					},
					{
						key: 'cf_ray',
						label: 'CF Ray',
						className: 'anon-table-col-cf-ray',
						render: (row) => {
							const ray = row.cf_ray ?? '';
							if (!ray) return '—';
							return `<span class="share-table-cf-ray" title="Cloudflare request ID: search in Cloudflare Logs / Log Explorer to match this request">${escapeHtml(truncateStr(ray, 24))}</span>`;
						}
					},
					{
						key: 'transitioned_user_id',
						label: 'Transitioned',
						className: 'anon-table-col-transitioned',
						render: (row) => {
							const uid = row.transitioned_user_id;
							const name = row.transitioned_user_name && String(row.transitioned_user_name).trim() ? String(row.transitioned_user_name).trim() : null;
							const profileHref = uid != null ? (buildProfilePath({ userName: name, userId: uid }) || `/user/${uid}`) : null;
							const label = uid != null ? (name ? `@${name}` : `User ${uid}`) : null;
							if (profileHref && label) {
								return `<a href="${escapeHtml(profileHref)}" class="anon-table-transitioned-link" onclick="event.stopPropagation()">${escapeHtml(label)}</a>`;
							}
							return uid != null ? 'Yes' : '—';
						}
					}
				],
				defaultSortBy: 'last_request_at',
				defaultSortDir: 'desc',
				emptyMessage: 'No try flow requests yet.',
				ariaLabelPagination: 'Try flow pagination',
				onRowClick: (row) => this.showAnonDetail(row.anon_cid),
				tableClassName: 'admin-table anon-table'
			});
		} catch (err) {
			container.innerHTML = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = 'Error loading try flow data.';
			container.appendChild(error);
		}
	}

	async loadShareViews() {
		const container = this.querySelector('[data-share-table-container]');
		if (!container) return;
		try {
			this._shareDataLoaded = true;
			await loadAdminDataTable(container, {
				fetchUrl: '/admin/share-views',
				responseItemsKey: 'items',
				columns: [
					{
						key: 'prsn_cid',
						label: 'Client Id',
						className: 'share-table-col-prsn-cid',
						render: (row) => {
							const pc = row.prsn_cid && String(row.prsn_cid).trim();
							return pc ? escapeHtml(truncateCid(pc, 18)) : '—';
						}
					},
					{
						key: 'anon_cid',
						label: 'Anon Id',
						sortKey: 'anon_cid',
						className: 'share-table-col-cid',
						render: (row) => escapeHtml(truncateStr(row.anon_cid, 12))
					},
					{
						key: 'viewed_at',
						label: 'Viewed',
						sortKey: 'viewed_at',
						className: 'share-table-col-date',
						render: (row) => escapeHtml(row.viewed_at ? formatLocalDateTime(row.viewed_at) : '—')
					},
					{ key: 'sharer_label', label: 'Sharer', sortKey: 'sharer_user_id', className: 'share-table-col-sharer' },
					{ key: 'creator_label', label: 'Creator', sortKey: 'created_by_user_id', className: 'share-table-col-creator' },
					{
						key: 'created_image_id',
						label: 'Creation',
						sortKey: 'created_image_id',
						className: 'share-table-col-creation',
						render: (row) => {
							const raw = row.created_image_id;
							if (raw != null && Number.isFinite(Number(raw))) {
								return `<a href="/creations/${escapeHtml(String(raw))}">${escapeHtml(String(raw))}</a>`;
							}
							return escapeHtml(String(raw ?? '—'));
						}
					},
					{
						key: 'user_agent',
						label: 'User agent',
						className: 'share-table-col-user-agent',
						render: (row) => escapeHtml(truncateStr(row.user_agent ?? '', 60))
					},
					{
						key: 'ip',
						label: 'IP',
						className: 'share-table-col-ip',
						render: (row) => {
							const ip = row.ip ?? '';
							const src = row.ip_source ?? '';
							const ipStr = escapeHtml(truncateStr(ip, 45));
							if (!ipStr) return '—';
							if (src) {
								return `${ipStr} <span class="share-table-ip-source" title="IP from header: ${escapeHtml(src)}">${escapeHtml(src)}</span>`;
							}
							return ipStr;
						}
					},
					{
						key: 'location',
						label: 'Location',
						className: 'share-table-col-location',
						render: (row) => {
							const parts = [row.city, row.region, row.country].filter(Boolean);
							return parts.length ? escapeHtml(parts.join(', ')) : '—';
						}
					},
					{
						key: 'cf_ray',
						label: 'CF Ray',
						className: 'share-table-col-cf-ray',
						render: (row) => {
							const ray = row.cf_ray ?? '';
							if (!ray) return '—';
							return `<span class="share-table-cf-ray" title="Cloudflare request ID: search in Cloudflare Logs / Log Explorer to match this request">${escapeHtml(truncateStr(ray, 24))}</span>`;
						}
					},
					{
						key: 'referer',
						label: 'Referer',
						sortKey: 'referer',
						className: 'share-table-col-referer',
						render: (row) => escapeHtml(truncateStr(row.referer, 50))
					}
				],
				defaultSortBy: 'viewed_at',
				defaultSortDir: 'desc',
				emptyMessage: 'No share page views yet.',
				ariaLabelPagination: 'Share page views pagination',
				tableClassName: 'admin-table share-table anon-table'
			});
		} catch (err) {
			container.innerHTML = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = 'Error loading share views.';
			container.appendChild(error);
		}
	}

	async loadBlogAnalytics() {
		const container = this.querySelector('[data-blog-analytics-root]');
		if (!container) return;
		try {
			const res = await fetch('/api/blog/analytics/summary', { credentials: 'include' });
			if (!res.ok) {
				const errText = res.status === 403 ? 'Forbidden' : 'Failed to load blog analytics.';
				throw new Error(errText);
			}
			const data = await res.json();
			this._blogDataLoaded = true;
			this.renderBlogAnalytics(container, data);
		} catch (err) {
			container.innerHTML = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = err?.message || 'Error loading blog analytics.';
			container.appendChild(error);
		}
	}

	renderBlogAnalytics(container, data) {
		container.innerHTML = '';
		const total = Number(data.total) || 0;
		const posts = Array.isArray(data.posts) ? [...data.posts] : [];
		const byCampaign = Array.isArray(data.byCampaign) ? [...data.byCampaign] : [];

		posts.sort((a, b) => Number(b.views) - Number(a.views));
		byCampaign.sort((a, b) => Number(b.views) - Number(a.views));

		const wrap = document.createElement('div');
		wrap.className = 'blog-analytics-content';

		const totalP = document.createElement('p');
		totalP.className = 'admin-detail';
		totalP.textContent = `Total recorded views: ${total}`;
		wrap.appendChild(totalP);

		const postsSection = document.createElement('section');
		postsSection.className = 'admin-settings-section';

		const postsTitle = document.createElement('span');
		postsTitle.className = 'admin-settings-section-title';
		postsTitle.textContent = 'Posts';
		postsSection.appendChild(postsTitle);

		if (posts.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'admin-empty';
			empty.textContent = 'No blog posts.';
			postsSection.appendChild(empty);
		} else {
			const table = document.createElement('table');
			table.className = 'admin-table blog-analytics-posts-table';
			table.setAttribute('role', 'grid');
			const thead = document.createElement('thead');
			const thr = document.createElement('tr');
			for (const label of ['Post', 'Slug', 'Status', 'Views']) {
				const th = document.createElement('th');
				th.scope = 'col';
				th.textContent = label;
				thr.appendChild(th);
			}
			thead.appendChild(thr);
			table.appendChild(thead);
			const tbody = document.createElement('tbody');
			for (const p of posts) {
				const tr = document.createElement('tr');
				const slug = String(p.slug || '').trim();
				const title = String(p.title || '').trim() || '—';
				const href = slug ? `/blog/${encodeURIComponent(slug)}` : null;
				const id = p.id;

				const tdPost = document.createElement('td');
				tdPost.className = 'blog-analytics-col-post';
				if (href) {
					const titleLink = document.createElement('a');
					titleLink.href = href;
					titleLink.textContent = title;
					tdPost.appendChild(titleLink);
				} else {
					tdPost.textContent = title;
				}
				if (id != null) {
					tdPost.appendChild(document.createTextNode(' '));
					const edit = document.createElement('a');
					edit.href = `/create/blog/${id}`;
					edit.className = 'blog-analytics-edit-link';
					edit.textContent = 'Edit';
					tdPost.appendChild(edit);
				}
				tr.appendChild(tdPost);

				const tdSlug = document.createElement('td');
				tdSlug.className = 'blog-analytics-col-slug';
				tdSlug.textContent = slug || '—';
				tr.appendChild(tdSlug);

				const tdStatus = document.createElement('td');
				tdStatus.textContent = String(p.status || '—');
				tr.appendChild(tdStatus);

				const tdViews = document.createElement('td');
				tdViews.textContent = String(Number(p.views) || 0);
				tr.appendChild(tdViews);

				tbody.appendChild(tr);
			}
			table.appendChild(tbody);
			postsSection.appendChild(table);
		}
		wrap.appendChild(postsSection);

		if (byCampaign.length > 0) {
			const campSection = document.createElement('section');
			campSection.className = 'admin-settings-section';

			const campTitle = document.createElement('span');
			campTitle.className = 'admin-settings-section-title';
			campTitle.textContent = 'Views by campaign';
			campSection.appendChild(campTitle);

			const ctable = document.createElement('table');
			ctable.className = 'admin-table blog-analytics-campaign-table';
			ctable.setAttribute('role', 'grid');
			const cthead = document.createElement('thead');
			const cthr = document.createElement('tr');
			for (const label of ['Campaign', 'Views']) {
				const th = document.createElement('th');
				th.scope = 'col';
				th.textContent = label;
				cthr.appendChild(th);
			}
			cthead.appendChild(cthr);
			ctable.appendChild(cthead);
			const cbody = document.createElement('tbody');
			for (const row of byCampaign) {
				const tr = document.createElement('tr');
				const cid = row.campaign_id;
				const label = cid == null || cid === '' ? '—' : String(cid);
				const tdC = document.createElement('td');
				tdC.textContent = label;
				tr.appendChild(tdC);
				const tdV = document.createElement('td');
				tdV.textContent = String(Number(row.views) || 0);
				tr.appendChild(tdV);
				cbody.appendChild(tr);
			}
			ctable.appendChild(cbody);
			campSection.appendChild(ctable);
			wrap.appendChild(campSection);
		}

		container.appendChild(wrap);
	}

	async exportShareViewsForChatGPT({ statusEl } = {}) {
		if (this._shareExportInFlight) return;
		this._shareExportInFlight = true;

		const setStatus = (msg) => {
			if (statusEl) statusEl.textContent = msg || '';
		};

		try {
			setStatus('Preparing share export…');

			const limit = 200;
			const sortBy = 'viewed_at';
			const sortDir = 'desc';
			let offset = 0;
			const allItems = [];
			let total = null;

			while (true) {
				const params = new URLSearchParams({
					limit: String(limit),
					offset: String(offset),
					sort_by: sortBy,
					sort_dir: sortDir
				});
				const res = await fetch(`/admin/share-views?${params}`, { credentials: 'include' });
				if (!res.ok) throw new Error('Failed to load share views.');
				const data = await res.json();

				const items = Array.isArray(data?.items) ? data.items : [];
				total = Number(data?.total) ?? total ?? 0;
				allItems.push(...items);

				if (items.length === 0) break;
				if (total != null && allItems.length >= total) break;
				offset += items.length;
			}

			const payload = {
				export_version: 1,
				exported_at: new Date().toISOString(),
				scope: '/analytics#share',
				item_count: allItems.length,
				field_notes: [
					'`prsn_cid` on each row is the Client Id (stable browser id, also meta.client_id); links rows across anon sessions.',
					'`cf_ray` is a Cloudflare request id; use it to correlate logs.',
					'`ip_source` is derived from headers if available.'
				],
				data: {
					shareViews: allItems
				}
			};

			const text = `PARASCENE_ADMIN_EXPORT\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
			await copyTextToClipboard(text);
			window.__parasceneAdminChatGPTExport = text;
			setStatus('Copied share export to clipboard.');
		} catch (err) {
			setStatus(`Export failed: ${err?.message || String(err)}`);
		} finally {
			this._shareExportInFlight = false;
		}
	}

	async exportAnonUsersForChatGPT({ mode = 'summary', statusEl } = {}) {
		if (this._anonExportInFlight) return;
		this._anonExportInFlight = true;

		const setStatus = (msg) => {
			if (statusEl) statusEl.textContent = msg || '';
		};

		try {
			setStatus(mode === 'expanded' ? 'Preparing anon requests export…' : 'Preparing anon summary export…');

			const limit = 200;
			const sortBy = 'last_request_at';
			const sortDir = 'desc';

			let offset = 0;
			const anonRows = [];
			let total = null;

			while (true) {
				const params = new URLSearchParams({
					limit: String(limit),
					offset: String(offset),
					sort_by: sortBy,
					sort_dir: sortDir
				});
				const res = await fetch(`/admin/anonymous-users?${params}`, { credentials: 'include' });
				if (!res.ok) throw new Error('Failed to load anonymous user data.');
				const data = await res.json();

				const items = Array.isArray(data?.anonCids) ? data.anonCids : [];
				total = Number(data?.total) ?? total ?? 0;
				anonRows.push(...items);

				if (items.length === 0) break;
				if (total != null && anonRows.length >= total) break;
				offset += items.length;
			}

			if (mode === 'summary') {
				const payload = {
					export_version: 1,
					exported_at: new Date().toISOString(),
					scope: '/analytics#anonymous (summary)',
					item_count: anonRows.length,
					field_notes: [
						'`prsn_cid` is the Client Id from try meta (stable browser id; links across ps_cid sessions when present).',
						'`from_share` indicates whether this anon cid appears in the share-views data.',
						'`transitioned_user_id` is the logged-in user the try-flow was transitioned into (if available).'
					],
					data: {
						anonCids: anonRows
					}
				};

				const text = `PARASCENE_ADMIN_EXPORT\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
				await copyTextToClipboard(text);
				window.__parasceneAdminChatGPTExport = text;
				setStatus('Copied anon summary to clipboard.');
				return;
			}

			const MAX_CIDS_WITH_REQUESTS = 30;
			const anonCids = anonRows.map((r) => r.anon_cid).filter(Boolean).slice(0, MAX_CIDS_WITH_REQUESTS);

			const byCid = [];
			for (let i = 0; i < anonCids.length; i++) {
				const cid = anonCids[i];
				setStatus(`Fetching anon requests… (${i + 1}/${anonCids.length})`);
				const res = await fetch(`/admin/anonymous-users/${encodeURIComponent(cid)}`, { credentials: 'include' });
				if (!res.ok) throw new Error(`Failed to load request details for anon_cid=${cid}`);
				const data = await res.json();
				byCid.push({
					anon_cid: data?.anon_cid ?? cid,
					requests: Array.isArray(data?.requests) ? data.requests : []
				});
			}

			const payload = {
				export_version: 1,
				exported_at: new Date().toISOString(),
				scope: '/analytics#anonymous (expanded)',
				anon_cids_total: anonRows.length,
				anon_cids_included: byCid.length,
				truncated: anonRows.length > byCid.length,
				truncation_note: byCid.length < anonRows.length
					? `Expanded export is capped at ${MAX_CIDS_WITH_REQUESTS} anon_cids for practicality.`
					: null,
				data: {
					anonRequestsByCid: byCid
				},
				field_notes: [
					'Each request includes Client Id as `prsn_cid` in JSON when stored in meta (stable browser id).',
					'Request `prompt` is the raw try-flow prompt text.',
					'`image.image_url` points to the admin-served try image route when available.'
				]
			};

			const text = `PARASCENE_ADMIN_EXPORT\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
			await copyTextToClipboard(text);
			window.__parasceneAdminChatGPTExport = text;
			setStatus('Copied anon requests to clipboard.');
		} catch (err) {
			setStatus(`Export failed: ${err?.message || String(err)}`);
		} finally {
			this._anonExportInFlight = false;
		}
	}

	async loadAnonDetail(cid) {
		const requestsEl = this.querySelector('[data-anon-detail-requests]');
		if (!requestsEl) return;
		try {
			const response = await fetch(`/admin/anonymous-users/${encodeURIComponent(cid)}`, { credentials: 'include' });
			if (!response.ok) throw new Error('Failed to load request details.');
			const data = await response.json();
			const requests = data.requests ?? [];
			requestsEl.innerHTML = '';
			if (requests.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'admin-empty';
				empty.textContent = 'No requests.';
				requestsEl.appendChild(empty);
				return;
			}
			for (const req of requests) {
				const row = document.createElement('div');
				row.className = 'anon-request-row';
				const createdLabel = req.created_at ? formatRelativeTime(req.created_at, { style: 'long' }) : '—';
				const fulfilledLabel = req.fulfilled_at ? formatRelativeTime(req.fulfilled_at, { style: 'long' }) : '—';
				const promptEscaped = (req.prompt || '—').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
				const userAgentDisplay = truncateStr(req.user_agent ?? '', 50);
				const userAgentEscaped = (userAgentDisplay || '—').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
				const userAgentTitle = req.user_agent ? req.user_agent.replace(/"/g, '&quot;') : '';
				const prsnRaw = req.prsn_cid && String(req.prsn_cid).trim();
				const prsnEscaped = prsnRaw
					? prsnRaw.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
					: '';
				const ipEscaped = (req.ip ?? '—').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
				const ipSourceEscaped = (req.ip_source ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
				const cfRayEscaped = (req.cf_ray ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
				let imageBlock = '<span class="anon-request-no-image">No image</span>';
				if (req.image) {
					const img = req.image;
					const url = img.image_url || '';
					const altEscaped = (img.filename ? `Request image: ${img.filename}` : 'Request image').replace(/"/g, '&quot;');
					imageBlock = url
						? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="anon-request-image-link"><img src="${url}" alt="${altEscaped}" class="anon-request-thumb" loading="lazy" decoding="async" /></a>`
						: `<span class="anon-request-no-image">${String(img.status || '—').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
				}
				row.innerHTML = `
					<div class="anon-request-prompt">${promptEscaped}</div>
					<div class="anon-request-meta">
						<span class="anon-request-datetime" title="${(req.created_at || '').replace(/"/g, '&quot;')}">${createdLabel}</span>
						<span class="anon-request-fulfilled">Fulfilled ${fulfilledLabel}</span>
						${req.ip ? `<span class="anon-request-ip" title="${ipSourceEscaped ? `Source: ${ipSourceEscaped}` : ''}">${ipEscaped}${req.ip_source ? ` <span class="anon-request-ip-source">(${ipSourceEscaped})</span>` : ''}</span>` : ''}
						${prsnRaw ? `<span class="anon-request-prsn" title="Client Id (prsn_cid cookie) — stable browser id; links share/try across ps_cid sessions">${prsnEscaped}</span>` : ''}
						${req.cf_ray ? `<span class="anon-request-cf-ray" title="Cloudflare Ray ID: search in CF Logs to correlate">${cfRayEscaped}</span>` : ''}
						${req.user_agent ? `<span class="anon-request-user-agent" title="${userAgentTitle}">${userAgentEscaped}</span>` : ''}
					</div>
					<div class="anon-request-image">${imageBlock}</div>
				`;
				requestsEl.appendChild(row);
			}
		} catch (err) {
			requestsEl.innerHTML = '';
			const error = document.createElement('div');
			error.className = 'admin-error';
			error.textContent = 'Error loading request details.';
			requestsEl.appendChild(error);
		}
	}
}

customElements.define('app-route-analytics', AppRouteAnalytics);
