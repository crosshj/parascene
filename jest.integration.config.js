/** Integration tests only (Supabase, Resend, external APIs). Run via `npm run test:int`. */
export default {
	testEnvironment: 'node',
	transform: {},
	moduleNameMapper: {
		'^/icons/svg-strings\\.js$': '<rootDir>/test/mocks/iconsSvgStrings.js'
	},
	testMatch: ['**/test/**/*.integration.test.js'],
	testPathIgnorePatterns: ['/node_modules/'],
	setupFiles: ['<rootDir>/jest.setup.js']
};
