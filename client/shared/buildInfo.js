function readMeta(name) {
	return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || '';
}

export function getClientBuildInfo() {
	return {
		commit: readMeta('build-commit'),
		commitUrl: readMeta('build-commit-url'),
		deployedAt: readMeta('build-deployed-at'),
		version: readMeta('app-version'),
		buildSuffix: readMeta('build-suffix'),
		appBuild: readMeta('app-build')
	};
}

export function formatBuildCommit(commit) {
	const value = String(commit || '').trim();
	if (!value) return 'Unknown';
	return value.length <= 12 ? value : value.slice(0, 7);
}
