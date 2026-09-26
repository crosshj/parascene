export function createAppState(initialState) {
	let state = initialState;
	const subscribers = new Set();
	return {
		get() { return state; },
		set(nextState) {
			if (Object.is(state, nextState)) return state;
			state = nextState;
			for (const subscriber of subscribers) subscriber(state);
			return state;
		},
		update(updater) { return this.set(updater(state)); },
		subscribe(subscriber) {
			subscribers.add(subscriber);
			return () => subscribers.delete(subscriber);
		}
	};
}
