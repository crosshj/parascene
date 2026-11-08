const menu = document.querySelector('.admin-menu');
const creditsOutput = document.querySelector('[data-admin-credits]');

function renderCredits(value) {
	const balance = Number(value);
	if (!creditsOutput || !Number.isFinite(balance)) return;
	creditsOutput.textContent = `Credits: ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(balance)}`;
}

if (creditsOutput) {
	fetch('/api/credits', { credentials: 'same-origin', cache: 'no-store' })
		.then((response) => {
			if (!response.ok) throw new Error('Unable to load credits');
			return response.json();
		})
		.then((data) => renderCredits(data?.balance))
		.catch(() => { creditsOutput.textContent = 'Credits unavailable'; });
	document.addEventListener('credits-updated', (event) => {
		if (event.detail?.count != null) renderCredits(event.detail.count);
	});
}

document.addEventListener('pointerdown', (event) => {
	if (menu?.open && !menu.contains(event.target)) menu.open = false;
});

document.addEventListener('keydown', (event) => {
	if (event.key !== 'Escape' || !menu?.open) return;
	event.preventDefault();
	menu.open = false;
	menu.querySelector('summary')?.focus();
});

let adminTabsId = 0;

class AdminTabs extends HTMLElement {
	connectedCallback() {
		if (this._tabList) return;
		this._tabList = [...this.querySelectorAll('[data-admin-tab-list]')].find((item) => item.closest('admin-tabs') === this);
		this._tabs = [...this.querySelectorAll('[data-admin-tab]')].filter((item) => item.closest('admin-tabs') === this);
		this._panels = [...this.querySelectorAll('[data-admin-panel]')].filter((item) => item.closest('admin-tabs') === this);
		if (!this._tabList || !this._tabs.length || !this._panels.length) return;

		this._uid = this.id || `admin-tabs-${++adminTabsId}`;
		this._tabList.setAttribute('role', 'tablist');
		this._tabs.forEach((tab) => {
			const id = tab.dataset.adminTab;
			const panel = this._panels.find((item) => item.dataset.adminPanel === id);
			if (!panel) return;
			tab.type = 'button';
			tab.id ||= `${this._uid}-tab-${id}`;
			tab.setAttribute('role', 'tab');
			tab.setAttribute('aria-controls', panel.id ||= `${this._uid}-panel-${id}`);
			panel.setAttribute('role', 'tabpanel');
			panel.setAttribute('aria-labelledby', tab.id);
			if (!panel.hasAttribute('tabindex')) panel.tabIndex = 0;
		});

		this._onClick = (event) => {
			const tab = event.target.closest('[data-admin-tab]');
			if (tab && this.contains(tab)) this.activate(tab.dataset.adminTab, true);
		};
		this._onKeydown = (event) => {
			const tab = event.target.closest('[data-admin-tab]');
			if (!tab || !this.contains(tab)) return;
			const index = this._tabs.indexOf(tab);
			const next = event.key === 'ArrowRight' ? (index + 1) % this._tabs.length
				: event.key === 'ArrowLeft' ? (index - 1 + this._tabs.length) % this._tabs.length
					: event.key === 'Home' ? 0 : event.key === 'End' ? this._tabs.length - 1 : -1;
			if (next < 0) return;
			event.preventDefault();
			this.activate(this._tabs[next].dataset.adminTab, true);
		};
		this._onHashChange = () => this.activate(this.hashTab(), false, false);
		this._tabList.addEventListener('click', this._onClick);
		this._tabList.addEventListener('keydown', this._onKeydown);
		if (this.hasAttribute('sync-hash')) window.addEventListener('hashchange', this._onHashChange);

		const requested = this.hashTab() || this.getAttribute('active') || this._tabs.find((tab) => tab.hasAttribute('aria-selected'))?.dataset.adminTab;
		const initial = this._tabs.some((tab) => tab.dataset.adminTab === requested) ? requested : this._tabs[0].dataset.adminTab;
		this.activate(initial, false, false);
	}

	disconnectedCallback() {
		this._tabList?.removeEventListener('click', this._onClick);
		this._tabList?.removeEventListener('keydown', this._onKeydown);
		if (this._onHashChange) window.removeEventListener('hashchange', this._onHashChange);
		this._tabList = null;
	}

	hashTab() {
		if (!this.hasAttribute('sync-hash')) return null;
		try { return decodeURIComponent(location.hash.slice(1)); } catch { return null; }
	}

	activate(id, focus = false, updateHash = true) {
		const tab = this._tabs?.find((item) => item.dataset.adminTab === id);
		if (!tab) return;
		this._tabs.forEach((item) => {
			const active = item === tab;
			item.setAttribute('aria-selected', String(active));
			item.tabIndex = active ? 0 : -1;
			this._panels.find((panel) => panel.dataset.adminPanel === item.dataset.adminTab)?.toggleAttribute('hidden', !active);
		});
		this.setAttribute('active', id);
		if (updateHash && this.hasAttribute('sync-hash') && location.hash !== `#${encodeURIComponent(id)}`) {
			history.replaceState(history.state, '', `${location.pathname}${location.search}#${encodeURIComponent(id)}`);
		}
		if (focus) tab.focus();
		this.dispatchEvent(new CustomEvent('admin-tab-change', { detail: { id }, bubbles: true }));
	}
}

if (!customElements.get('admin-tabs')) customElements.define('admin-tabs', AdminTabs);
