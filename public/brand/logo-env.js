/* Match favicon.js: local development is green, beta is blue, production is purple. */
(function () {
	var host = String(location.hostname || "").toLowerCase();
	var env = host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1" || host === "[::1]"
		? "local"
		: host === "beta.parascene.com" ? "beta" : "prod";
	document.documentElement.dataset.env = env;
})();
