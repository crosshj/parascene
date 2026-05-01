/**
 * Chat loads this **only** via `import(\`…/challengesChannel.js\${qs}\`)` so this entry URL is cache-busted.
 * Nested static imports use normal relative URLs; hot spots (`challengeVoteModal`, `userText` via `mountPane.js`)
 * use `getChallengesImportQuery()` from `./challenges/constants.js` plus dynamic `import()`.
 */
export * from './challenges/index.js';
