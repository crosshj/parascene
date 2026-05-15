export default {
	testEnvironment: 'node',
	transform: {},
	moduleNameMapper: {
		'^/icons/svg-strings\\.js$': '<rootDir>/test/mocks/iconsSvgStrings.js'
	},
	testMatch: ['**/test/**/*.test.js'],
	testPathIgnorePatterns: [
		'/node_modules/',
		'\\.integration\\.test\\.js$'
	],
	setupFiles: ['<rootDir>/jest.setup.js']
};
