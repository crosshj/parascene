export default {
	testEnvironment: 'node',
	transform: {},
	moduleNameMapper: {
		'^/icons/svg-strings\\.js$': '<rootDir>/test/mocks/iconsSvgStrings.js'
	},
	testMatch: ['**/test/**/*.test.js'],
	testPathIgnorePatterns: [
		'/node_modules/',
		'\\.integration\\.test\\.js$',
		// Node built-in test runner (`node:test`), not Jest — run via `node --test`
		'/test/googlePhotosAuth\\.test\\.js$',
		'/test/recommendableCreations\\.test\\.js$'
	],
	setupFiles: ['<rootDir>/jest.setup.js']
};
