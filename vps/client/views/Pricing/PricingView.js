import { requestJson } from '../../core/request.js';
import { userAvatarIcon } from '../../icons/svg-strings.js';
import './PricingView.css';

const SUCCESS_COPY = {
	activation: {
		subtitle: 'Thank you. Your Founder plan is being activated.',
		html: '<p class="pricing-success-message-title">Payment successful</p><p>Thank you for subscribing. Your first 700 credits are being added now, along with priority support and Founder flair.</p><p>Watch for a welcome notification and email. Refresh in a moment to see your plan update, or continue exploring.</p><p>You can switch back to Free anytime from the pricing page.</p>',
	},
	topup: {
		subtitle: 'Credits are being added to your account.',
		html: '<p class="pricing-success-message-title">Payment successful</p><p>Your credit pack is being added. You\'ll get a notification and email when the credits land. Refresh in a moment to see your updated balance, or continue exploring.</p>',
	},
	deactivation: {
		subtitle: 'You\'re now on the Free plan.',
		html: '<p class="pricing-success-message-title">Plan updated</p><p>You\'re now on the Free plan. You can resubscribe to Founder anytime.</p>',
	},
};

function markup() {
	return `<div class="pricing-view__lead">
		<p class="pricing-view__subtitle" data-pricing-subtitle>Start free, unlock Founder, or buy credits.</p>
		<p class="pricing-intro">Parascene is free to use. Founder is a monthly subscription for more credits and perks. Credit packs are a one-time top-up when you just need more balance.</p>
	</div>
	<div class="pricing-success-state-content" data-pricing-success hidden>
		<div class="pricing-success-message" data-pricing-success-message role="status"></div>
		<div class="pricing-success-actions"><button type="button" class="pricing-success-btn pricing-success-btn-primary" data-pricing-continue>Continue</button></div>
	</div>
	<div class="pricing-loading" data-pricing-loading aria-live="polite"><p role="status">Loading pricing…</p></div>
	<div class="pricing-content" data-pricing-content>
		<div class="pricing-grid">
			<div class="pricing-card" data-pricing-tier="free">
				<h3>Free</h3>
				<div class="pricing-avatar-preview pricing-avatar-preview--plain" aria-hidden="true"><div class="pricing-avatar-plain" data-pricing-avatar></div></div>
				<p class="pricing-price">$0 <span>always</span></p>
				<ul>
					<li>Create with AI and generative tools</li>
					<li>Claim free credits daily</li>
					<li>Share creations and build a profile</li>
					<li>Comment, follow, and explore</li>
				</ul>
				<div data-pricing-cta-free><button type="button" class="btn-secondary" data-pricing-switch>Switch to Free</button></div>
				<span class="pricing-current-badge" data-pricing-badge-free hidden>Current plan</span>
			</div>
			<div class="pricing-card" data-pricing-tier="founder">
				<h3>Founder</h3>
				<div class="pricing-avatar-preview pricing-founder-flair-preview" aria-hidden="true">
					<div class="founder-flair-mock"><div class="founder-flair-avatar"><div class="founder-flair-avatar-inner" data-pricing-avatar></div></div><div class="founder-flair-label">Founder</div></div>
				</div>
				<p class="pricing-price">$12 <span>/ month</span></p>
				<ul>
					<li class="pricing-feature-founder"><strong>700 credits per month</strong></li>
					<li class="pricing-feature-founder"><strong>Priority support</strong></li>
					<li class="pricing-feature-founder"><strong>Early feature consideration</strong></li>
					<li class="pricing-feature-founder"><strong>Founder flair</strong> — lifetime</li>
				</ul>
				<div data-pricing-cta-founder><a href="/pricing" class="btn-primary" data-pricing-founder>Unlock Founder</a></div>
				<span class="pricing-current-badge" data-pricing-badge-founder hidden>Current plan</span>
			</div>
		</div>
		<section class="pricing-packs">
			<h3 class="pricing-packs-title">Credit packs</h3>
			<p class="pricing-packs-intro">One-time purchase. Credits are added to your balance after payment. Founder is still the better monthly rate if you create often.</p>
			<div class="pricing-packs-grid">
				<div class="pricing-card" data-pricing-pack="100"><h3>100 credits</h3><p class="pricing-price">$3 <span>one time</span></p><p class="pricing-pack-note" aria-hidden="true"></p><a href="/pricing" class="btn-outlined" data-pricing-pack="100">Buy 100 credits</a></div>
				<div class="pricing-card" data-pricing-pack="300"><h3>300 credits</h3><p class="pricing-price">$7 <span>one time</span></p><p class="pricing-pack-note" aria-hidden="true"></p><a href="/pricing" class="btn-outlined" data-pricing-pack="300">Buy 300 credits</a></div>
				<div class="pricing-card" data-pricing-pack="700"><h3>700 credits</h3><p class="pricing-price">$15 <span>one time</span></p><p class="pricing-pack-note">Best deal</p><a href="/pricing" class="btn-outlined" data-pricing-pack="700">Buy 700 credits</a></div>
			</div>
		</section>
		<div class="pricing-team-message">
			<h4 class="pricing-team-message-title">A special note for early users</h4>
			<p>Parascene is early and evolving. Founder members help define what it becomes.</p>
			<p>As a Founder, you receive priority support and early feature consideration — your input directly shapes the roadmap.</p>
		</div>
	</div>`;
}

export const PricingView = Object.freeze({
	mount({ outlet, actions, services, url = '/pricing' } = {}) {
		const root = document.createElement('section');
		root.className = 'pricing-view';
		root.innerHTML = markup();
		outlet.replaceChildren(root);
		let closed = false;
		let controller = null;
		let spinnerTimer = 0;
		const icon = userAvatarIcon();
		for (const slot of root.querySelectorAll('[data-pricing-avatar]')) slot.innerHTML = icon;

		function showSuccess(variant) {
			const copy = SUCCESS_COPY[variant] || SUCCESS_COPY.activation;
			root.classList.add('pricing-success-state', 'pricing-ready');
			root.querySelector('[data-pricing-subtitle]').textContent = copy.subtitle;
			root.querySelector('[data-pricing-success-message]').innerHTML = copy.html;
			root.querySelector('[data-pricing-success]').hidden = false;
		}

		function showPlans() {
			root.classList.remove('pricing-success-state');
			root.classList.add('pricing-ready');
			root.querySelector('[data-pricing-success]').hidden = true;
			root.querySelector('[data-pricing-subtitle]').textContent = 'Start free, unlock Founder, or buy credits.';
		}

		function paintPlan(plan) {
			root.querySelector('[data-pricing-badge-free]').hidden = plan !== 'free';
			root.querySelector('[data-pricing-badge-founder]').hidden = plan !== 'founder';
			root.querySelector('[data-pricing-switch]').classList.toggle('pricing-cta-visible', plan === 'founder');
			root.querySelector('[data-pricing-founder]').hidden = plan === 'founder';
		}

		function paintAvatar(avatarUrl) {
			if (!avatarUrl) return;
			for (const slot of root.querySelectorAll('[data-pricing-avatar]')) {
				slot.replaceChildren();
				const image = document.createElement('img');
				image.src = avatarUrl;
				image.alt = '';
				image.className = 'pricing-avatar-img';
				slot.append(image);
			}
		}

		async function checkout(path, body, control) {
			if (control.getAttribute('aria-busy') === 'true') return;
			const original = control.textContent;
			control.setAttribute('aria-busy', 'true');
			control.textContent = 'Redirecting…';
			try {
				const data = await requestJson(path, { method: 'POST', body });
				if (data?.url) {
					window.location.href = data.url;
					return;
				}
				throw new Error('Could not start checkout.');
			} catch (error) {
				if (closed) return;
				if (error.status === 401) {
					services?.session?.redirectToLogin?.();
					return;
				}
				control.removeAttribute('aria-busy');
				control.textContent = original;
				window.alert(error.message || 'Could not start checkout.');
			}
		}

		root.addEventListener('click', (event) => {
			if (event.target.closest('[data-pricing-continue]')) {
				showPlans();
				return;
			}
			const founder = event.target.closest('[data-pricing-founder]');
			if (founder) {
				event.preventDefault();
				void checkout('/api/subscription/checkout', undefined, founder);
				return;
			}
			const pack = event.target.closest('a[data-pricing-pack]');
			if (pack) {
				event.preventDefault();
				void checkout('/api/credits/checkout', { pack: pack.getAttribute('data-pricing-pack') }, pack);
				return;
			}
			const switchButton = event.target.closest('[data-pricing-switch]');
			if (!switchButton || switchButton.getAttribute('aria-busy') === 'true') return;
			switchButton.setAttribute('aria-busy', 'true');
			switchButton.disabled = true;
			const original = switchButton.textContent;
			switchButton.textContent = 'Updating…';
			void requestJson('/api/profile/plan', { method: 'PUT', body: { plan: 'free' } }).then((data) => {
				if (closed) return;
				paintPlan(data?.plan || 'free');
				if (data?.plan === 'free') showSuccess('deactivation');
			}).catch((error) => {
				if (closed) return;
				switchButton.removeAttribute('aria-busy');
				switchButton.disabled = false;
				switchButton.textContent = original;
				window.alert(error.message || 'Could not update plan.');
			});
		});

		async function load(routeUrl) {
			controller?.abort();
			controller = new AbortController();
			window.clearTimeout(spinnerTimer);
			spinnerTimer = window.setTimeout(() => {
				if (!closed && !root.classList.contains('pricing-ready')) root.querySelector('[data-pricing-loading]')?.classList.add('pricing-loading-delayed-show');
			}, 2000);
			const route = new URL(routeUrl || url, location.origin);
			const switchedFree = route.searchParams.get('switched') === 'free';
			const topup = route.searchParams.get('topup') === '1';
			const success = route.searchParams.get('success') === '1';
			const sessionId = route.searchParams.get('session_id') || '';
			try {
				const data = await requestJson('/api/profile', { signal: controller.signal });
				if (closed) return;
				paintAvatar(typeof data?.profile?.avatar_url === 'string' ? data.profile.avatar_url.trim() : '');
				const plan = data?.plan || 'free';
				paintPlan(plan);
				if (switchedFree && plan === 'free') showSuccess('deactivation');
				else if (topup) showSuccess('topup');
				else if (success && sessionId) {
					showSuccess('activation');
					void requestJson('/api/subscription/checkout-return', { method: 'POST', body: { sessionId } }).catch(() => undefined);
				} else if (data?.pendingPlanActivation && plan === 'free') showSuccess('activation');
				else if (success) showSuccess(plan === 'free' ? 'deactivation' : 'activation');
				else showPlans();
				if ((switchedFree || topup || success) && route.search) {
					history.replaceState(history.state, '', '/pricing');
				}
			} catch (error) {
				if (closed || error.name === 'AbortError') return;
				if (error.status === 401) {
					services?.session?.redirectToLogin?.();
					return;
				}
				showPlans();
				root.querySelector('[data-pricing-subtitle]').textContent = error.message || 'Could not load pricing.';
			}
		}

		const backgroundReady = load(url);
		return {
			backgroundReady,
			update({ url: nextUrl } = {}) {
				if (nextUrl && nextUrl !== url) {
					url = nextUrl;
					void load(url);
				}
			},
			destroy() {
				closed = true;
				controller?.abort();
				window.clearTimeout(spinnerTimer);
				root.remove();
			},
		};
	},
});
