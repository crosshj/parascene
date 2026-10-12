export function isGroupHeroBlurred(hero) {
	return Boolean(hero?.classList.contains('nsfw') &&
		!hero.classList.contains('nsfw-revealed') &&
		!hero.ownerDocument.body.classList.contains('view-nsfw'));
}

export function watchGroupNavigation(hero) {
	if (!hero) return () => {};
	const sync = () => {
		for (const button of hero.querySelectorAll('[data-group-hero-prev], [data-group-hero-next]')) {
			button.disabled = button.hidden || isGroupHeroBlurred(hero);
		}
	};
	const observer = new hero.ownerDocument.defaultView.MutationObserver(sync);
	observer.observe(hero, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] });
	observer.observe(hero.ownerDocument.body, { attributes: true, attributeFilter: ['class'] });
	sync();
	return () => observer.disconnect();
}
