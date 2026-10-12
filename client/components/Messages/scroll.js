// WWW thread scrolling: land at latest, keep the bottom only while the reader
// is near it, and preserve a visible message while older history is prepended.
export function createMessagesScroll({ viewport, content, onLatestVisible }) {
	let following = true;
	let anchor = null;
	let frame = 0;
	let jumpFrame = 0;
	let jumpTimer = 0;
	let jump = null;
	let settleFrame = 0;
	let settling = false;
	const settleTimers = new Set();
	function stopSettling() {
		settling = false;
		cancelAnimationFrame(settleFrame);
		for (const timer of settleTimers) clearTimeout(timer);
		settleTimers.clear();
	}
	function capture() {
		if (viewport.dataset.chatMessagesScrollLock === '1') return;
		if (jump) return;
		if (!settling) following = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 64;
		const top = viewport.getBoundingClientRect().top;
		const row = [...content.querySelectorAll('[data-chat-message-id]')].find((element) => element.getBoundingClientRect().bottom > top);
		anchor = row ? { id: row.dataset.chatMessageId, offset: row.getBoundingClientRect().top - top } : null;
	}
	function restore() {
		if (viewport.dataset.chatMessagesScrollLock === '1') { viewport.scrollTop = 0; return; }
		if (jump) return;
		if (following) viewport.scrollTop = viewport.scrollHeight;
		else if (anchor) {
			const row = [...content.querySelectorAll('[data-chat-message-id]')].find((element) => element.dataset.chatMessageId === anchor.id);
			if (row) viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
		}
		if (following) onLatestVisible?.();
	}
	function finishJump() {
		if (!jump?.started) return;
		const completed = jump;
		jump = null;
		clearTimeout(jumpTimer);
		capture();
		if (following) onLatestVisible?.();
		if (completed.target.isConnected) completed.onArrive?.(completed.target);
	}
	function cancelJump() {
		if (!jump) return;
		jump = null;
		cancelAnimationFrame(jumpFrame); clearTimeout(jumpTimer);
		// Stop any browser smooth scroll before adopting the reader's position.
		viewport.scrollTo({ top: viewport.scrollTop, behavior: 'instant' });
		capture();
	}
	function onScroll() {
		if (viewport.dataset.chatMessagesScrollLock === '1') { viewport.scrollTop = 0; return; }
		if (jump) {
			if (jump.started) { clearTimeout(jumpTimer); jumpTimer = setTimeout(finishJump, 180); }
			return;
		}
		if (settling) { restore(); return; }
		capture(); if (following) onLatestVisible?.();
	}
	function onUserScroll() {
		stopSettling();
		cancelJump();
	}
	function onKeydown(event) {
		if (event.target.closest('textarea, input, select, [contenteditable="true"]')) return;
		if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) onUserScroll();
	}
	const observer = new ResizeObserver(() => {
		cancelAnimationFrame(frame);
		if (viewport.dataset.chatMessagesScrollLock === '1') return;
		frame = requestAnimationFrame(restore);
	});
	observer.observe(content);
	function observeRows() {
		// The WWW stream is itself the fixed-height viewport. Observe its
		// direct message rows too, so late media sizing preserves the anchor.
		observer.disconnect(); observer.observe(content);
		for (const row of content.querySelectorAll('.connect-chat-msg')) observer.observe(row);
	}
	viewport.addEventListener('scroll', onScroll, { passive: true });
	viewport.addEventListener('scrollend', finishJump);
	viewport.addEventListener('wheel', onUserScroll, { passive: true });
	viewport.addEventListener('touchstart', onUserScroll, { passive: true });
	viewport.addEventListener('pointerdown', onUserScroll, { passive: true });
	viewport.addEventListener('keydown', onKeydown);
	return {
		capture,
		restore,
		observeRows,
		jumpTo(target, onArrive) {
			stopSettling();
			cancelJump(); cancelAnimationFrame(frame);
			following = false;
			jump = { target, onArrive, started: false };
			// Wait for prepended rows and their resize notifications to settle.
			jumpFrame = requestAnimationFrame(() => {
				jumpFrame = requestAnimationFrame(() => {
					if (!target.isConnected) { cancelJump(); return; }
					jump.started = true;
					const rect = target.getBoundingClientRect();
					const top = viewport.scrollTop + rect.top - viewport.getBoundingClientRect().top - (viewport.clientHeight - rect.height) / 2;
					const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
					viewport.scrollTo({ top, behavior });
					// Also handle no movement and browsers without scrollend.
					jumpTimer = setTimeout(finishJump, 500);
				});
			});
		},
		latest() {
			stopSettling(); following = true; settling = true;
			restore();
			// Match WWW's fresh-load layout settling, including mobile WebKit.
			settleFrame = requestAnimationFrame(() => {
				restore(); settleFrame = requestAnimationFrame(restore);
			});
			for (const delay of [120, 320]) {
				const timer = setTimeout(() => {
					settleTimers.delete(timer); restore();
					if (delay === 320) settling = false;
				}, delay);
				settleTimers.add(timer);
			}
		},
		destroy() {
			stopSettling();
			cancelJump(); cancelAnimationFrame(frame); observer.disconnect();
			viewport.removeEventListener('scroll', onScroll);
			viewport.removeEventListener('scrollend', finishJump);
			viewport.removeEventListener('wheel', onUserScroll);
			viewport.removeEventListener('touchstart', onUserScroll);
			viewport.removeEventListener('pointerdown', onUserScroll);
			viewport.removeEventListener('keydown', onKeydown);
		},
	};
}
