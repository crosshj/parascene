const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function loadEnv() {
	require('dotenv').config({ path: path.join(REPO_ROOT, '.env') });
}

module.exports = { REPO_ROOT, loadEnv };
