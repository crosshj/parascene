import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import CleanCSS from "clean-css";
import terser from "@rollup/plugin-terser";

const vpsDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(vpsDir, "build");

function resolveBundledWwwImports() {
	return {
		name: 'resolve-vps-browser-imports',
		resolveId(source) {
			if (source === '/icons/svg-strings.js') return path.join(vpsDir, 'client', 'vendor', 'public', 'icons', 'svg-strings.js');
			if (source === '/pages/create-styles.js') return path.join(vpsDir, 'client', 'vendor', 'pages', 'create-styles.js');
			if (source === '/shared/createSubmit.js') return path.join(vpsDir, 'client', 'shared', 'createSubmit.js');
			if (source === '/shared/createWorkflowHost.js') return path.join(vpsDir, 'client', 'vendor', 'public', 'shared', 'createWorkflowHost.js');
			if (source === '/shared/escapeLayers.js') return path.join(vpsDir, 'client', 'vendor', 'public', 'shared', 'escapeLayers.js');
			if (source === '/shared/createSettingsSync.js') return path.join(vpsDir, 'client', 'vendor', 'public', 'shared', 'createSettingsSync.js');
			return null;
		},
	};
}

function resolveWwwRootImports() {
	const roots = new Map([
		['/shared/', [path.join(vpsDir, 'client', 'shared'), path.join(vpsDir, 'client', 'vendor', 'src', 'shared'), path.join(vpsDir, 'client', 'vendor', 'public', 'shared')]],
		['/icons/', [path.join(vpsDir, 'client', 'icons'), path.join(vpsDir, 'client', 'vendor', 'public', 'icons')]],
		['/components/', [path.join(vpsDir, 'client', 'vendor', 'public', 'components')]],
		['/chat/', [path.join(vpsDir, 'client', 'vendor', 'src', 'chat'), path.join(vpsDir, 'client', 'vendor', 'public', 'chat')]],
		['/pages/', [path.join(vpsDir, 'client', 'vendor', 'pages'), path.join(vpsDir, 'client', 'vendor', 'public', 'pages')]],
	]);
	return {
		name: 'resolve-www-root-imports',
		async resolveId(source, importer) {
			if (importer && /(?:^|\/)spaPageOverlay\.js$/.test(source)) {
				return path.join(vpsDir, 'client', 'shared', 'spaPageOverlay.js');
			}
			if (importer && /(?:^|\/)creationDetailRuntime\.js$/.test(source)) {
				return path.join(vpsDir, 'client', 'shared', 'creationDetailRuntime.js');
			}
			for (const [prefix, candidates] of roots) {
				if (!source.startsWith(prefix)) continue;
				const relative = source.slice(prefix.length);
				for (const root of candidates) {
					const candidate = path.join(root, relative);
					if (existsSync(candidate)) return candidate;
				}
			}
			if (importer?.startsWith(path.join(vpsDir, 'client')) && source.startsWith('.')) {
				const localCandidate = path.resolve(path.dirname(importer), source);
				if (!existsSync(localCandidate)) {
					const sharedMarker = `${path.sep}shared${path.sep}`;
					if (localCandidate.includes(sharedMarker)) {
						const relative = localCandidate.slice(localCandidate.indexOf(sharedMarker) + sharedMarker.length);
						for (const root of [path.join(vpsDir, 'client', 'vendor', 'src', 'shared'), path.join(vpsDir, 'client', 'vendor', 'public', 'shared')]) {
							const candidate = path.join(root, relative);
							if (existsSync(candidate)) return candidate;
						}
					}
				}
			}
			if (importer && source.startsWith('../components/')) {
				const candidate = path.join(vpsDir, 'client', 'vendor', 'public', source.slice(3));
				if (existsSync(candidate)) return candidate;
			}
			if (!source.startsWith('.') && !source.startsWith('/') && !source.startsWith('\0')) {
				try {
					const parts = source.split('/');
					const packageName = source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
					const packageRoot = path.join(vpsDir, 'node_modules', packageName);
					const subpath = parts.slice(source.startsWith('@') ? 2 : 1).join('/');
					if (subpath) {
						const direct = path.join(packageRoot, subpath);
						if (existsSync(direct)) return direct;
						if (existsSync(`${direct}.js`)) return `${direct}.js`;
					}
					const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
					const entry = packageJson.module || packageJson.browser || packageJson.main;
					if (typeof entry === 'string') return path.join(packageRoot, entry);
					return fileURLToPath(import.meta.resolve(source));
				} catch {
					return null;
				}
			}
			return null;
		},
	};
}

function staticDynamicImportSpecifier(source) {
	if (source?.type === 'Literal' && typeof source.value === 'string') return source.value;
	if (source?.type !== 'TemplateLiteral' || !source.quasis?.length) return null;
	const first = source.quasis[0]?.value?.cooked || '';
	const match = first.match(/^(.+\.js)$/);
	if (!match) return null;
	if (source.quasis.slice(1).some((part) => (part.value?.cooked || '') !== '')) return null;
	return match[1];
}

function staticallyBundleDynamicImports() {
	return {
		name: 'statically-bundle-dynamic-imports',
		transform(code, id) {
			if (!/\.[cm]?js$/.test(id)) return null;
			let ast;
			try {
				ast = this.parse(code);
			} catch {
				return null;
			}
			const imports = new Map();
			const replacements = [];
			const visit = (node) => {
				if (!node || typeof node !== 'object') return;
				if (node.type === 'ImportExpression') {
					const specifier = staticDynamicImportSpecifier(node.source);
					if (specifier) {
						let binding = imports.get(specifier);
						if (!binding) {
							binding = `__vpsStaticImport${imports.size}`;
							imports.set(specifier, binding);
						}
						replacements.push({ start: node.start, end: node.end, value: `Promise.resolve(${binding})` });
					} else if (id.includes(`${path.sep}@supabase${path.sep}supabase-js${path.sep}`) && node.source?.type === 'Identifier' && node.source.name === 'OTEL_PKG') {
						// Supabase's optional tracing probe intentionally resolves to null when OpenTelemetry is absent.
						replacements.push({ start: node.start, end: node.end, value: 'Promise.resolve(null)' });
					}
					return;
				}
				for (const value of Object.values(node)) {
					if (Array.isArray(value)) value.forEach(visit);
					else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value);
				}
			};
			visit(ast);
			if (!replacements.length) return null;
			let transformed = code;
			for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
				transformed = transformed.slice(0, replacement.start) + replacement.value + transformed.slice(replacement.end);
			}
			const prelude = [...imports].map(([specifier, binding]) =>
				`import * as ${binding} from ${JSON.stringify(specifier)};`
			).join('\n');
			return { code: `${prelude}\n${transformed}`, map: null };
		},
		generateBundle(_options, bundle) {
			for (const [fileName, output] of Object.entries(bundle)) {
				if (output.type !== 'chunk') continue;
				const escaped = [...output.code.matchAll(/\bimport\s*\(([^)]{0,180})\)/g)].map((match) => match[0]);
				if (escaped.length) {
					throw new Error(`Dynamic import escaped the VPS bundle: ${fileName}\n${escaped.join('\n')}`);
				}
			}
		},
	};
}

function assertVpsClientBoundary() {
	return {
		name: 'assert-vps-client-boundary',
		generateBundle() {
			const outside = [...this.getModuleIds()].filter((id) => {
				if (!path.isAbsolute(id) || id.startsWith('\0')) return false;
				const relative = path.relative(vpsDir, id);
				return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
			});
			if (outside.length) {
				throw new Error([
					'VPS browser bundle source must stay inside vps/.',
					'Copy the required implementation into vps/ and update its imports.',
					'Outside source modules:',
					...outside.sort().map((id) => `  - ${id}`),
				].join('\n'));
			}
		},
	};
}

function staticallyBundleRouteCardGroupMedia() {
	const target = path.join(vpsDir, 'client', 'vendor', 'public', 'shared', 'routeCardGroupMedia.js');
	const sourceRoot = path.join(vpsDir, 'client', 'vendor', 'src', 'shared');
	const publicRoot = path.join(vpsDir, 'client', 'vendor', 'public', 'shared');
	return {
		name: 'statically-bundle-route-card-group-media',
		transform(code, id) {
			if (id !== target) return null;
			const bodyStart = code.indexOf('function resolveRouteCardThumbUrl');
			if (bodyStart < 0) throw new Error('Could not locate routeCardGroupMedia module body');
			const prelude = [
				`import * as routeMediaMod from ${JSON.stringify(path.join(publicRoot, 'routeMedia.js'))};`,
				`import * as audioCoverWaveformMod from ${JSON.stringify(path.join(sourceRoot, 'audioCoverWaveform.js'))};`,
				`import * as creationGroupMediaMod from ${JSON.stringify(path.join(sourceRoot, 'creationGroupMedia.js'))};`,
				`import * as feedCardBuildMod from ${JSON.stringify(path.join(sourceRoot, 'feedCardBuild.js'))};`,
				'const { setRouteMediaBackgroundImage } = routeMediaMod;',
				'const { creationMediaType, creationNeedsAudioWaveformCover, isPlaceholderAudioCover, mountAudioCoverWaveform, removeAudioCoverWaveform } = audioCoverWaveformMod;',
				'const { normalizeRouteCardFeedItem, parseCreationItemMeta, resolveGroupCoverDisplayUrl, isGroupCreationItem, routeCardGroupBadgeHtml } = creationGroupMediaMod;',
				'const { getFeedItemGroupCarouselSources, getFeedItemGroupVideoSlides, setupFeedCardGroupCarousel, setupFeedCardGroupVideoPlaylist, feedItemCardImageUrl, isFeedCreationImageProcessing } = feedCardBuildMod;',
			].join('\n');
			return { code: `${prelude}\n${code.slice(bodyStart)}`, map: null };
		},
	};
}

function staticallyBundleCreationCommentsThread() {
	const target = path.join(vpsDir, 'client', 'vendor', 'src', 'shared', 'creationCommentsThread.js');
	const sharedRoot = path.join(vpsDir, 'client', 'shared');
	const icons = path.join(vpsDir, 'client', 'icons', 'svg-strings.js');
	return {
		name: 'statically-bundle-creation-comments-thread',
		transform(code, id) {
			if (id !== target) return null;
			const bodyStart = code.indexOf('function escapeHtml');
			if (bodyStart < 0) throw new Error('Could not locate creationCommentsThread module body');
			const modules = [
				['datetimeMod', path.join(sharedRoot, 'datetime.js')],
				['commentsMod', path.join(sharedRoot, 'comments.js')],
				['replyUiMod', path.join(sharedRoot, 'replyIndicatorUi.js')],
				['userTextMod', path.join(sharedRoot, 'userText.js')],
				['autogrowMod', path.join(sharedRoot, 'autogrow.js')],
				['suggestMod', path.join(sharedRoot, 'triggeredSuggest.js')],
				['profileLinksMod', path.join(sharedRoot, 'profileLinks.js')],
				['iconsMod', icons],
				['replyPreviewMod', path.join(sharedRoot, 'plainTextReplyPreview.js')],
				['emptyStateMod', path.join(sharedRoot, 'emptyState.js')],
				['commentItemMod', path.join(sharedRoot, 'commentItem.js')],
				['createSubmitMod', path.join(sharedRoot, 'createSubmit.js')],
				['avatarMod', path.join(sharedRoot, 'avatar.js')],
				['tooltipTapMod', path.join(sharedRoot, 'reactionTooltipTap.js')],
			];
			const imports = modules.map(([name, file]) => `import * as ${name} from ${JSON.stringify(file)};`).join('\n');
			const deps = `const bundledCommentsThreadDeps = Object.freeze({
				formatDateTime: datetimeMod.formatDateTime,
				formatRelativeTime: datetimeMod.formatRelativeTime,
				fetchCreatedImageActivity: commentsMod.fetchCreatedImageActivity,
				postCreatedImageComment: commentsMod.postCreatedImageComment,
				toggleCommentReaction: commentsMod.toggleCommentReaction,
				deleteCreatedImageComment: commentsMod.deleteCreatedImageComment,
				updateCreatedImageComment: commentsMod.updateCreatedImageComment,
				createReplyIndicatorElement: replyUiMod.createReplyIndicatorElement,
				processUserText: userTextMod.processUserText,
				hydrateRichUserTextEmbeds: userTextMod.hydrateRichUserTextEmbeds,
				hydrateUserTextLinks: userTextMod.hydrateUserTextLinks,
				attachAutoGrowTextarea: autogrowMod.attachAutoGrowTextarea,
				composerEnterKeySubmits: autogrowMod.composerEnterKeySubmits,
				attachMentionSuggest: suggestMod.attachMentionSuggest,
				attachCommentComposerSuggest: suggestMod.attachCommentComposerSuggest,
				attachPromptInlineSuggest: suggestMod.attachPromptInlineSuggest,
				isTriggeredSuggestPopupOpen: suggestMod.isTriggeredSuggestPopupOpen,
				addPageUsers: suggestMod.addPageUsers,
				buildProfilePath: profileLinksMod.buildProfilePath,
				creditIcon: iconsMod.creditIcon,
				sendIcon: iconsMod.sendIcon,
				plusIcon: iconsMod.plusIcon,
				smileIcon: iconsMod.smileIcon,
				replyTurnIcon: iconsMod.replyTurnIcon,
				REACTION_ORDER: iconsMod.REACTION_ORDER,
				REACTION_ICONS: iconsMod.REACTION_ICONS,
				plainTextReplyPreview: replyPreviewMod.plainTextReplyPreview,
				renderEmptyState: emptyStateMod.renderEmptyState,
				renderCommentAvatarHtml: commentItemMod.renderCommentAvatarHtml,
				uploadImageFile: createSubmitMod.uploadImageFile,
				formatMentionsFailureForDialog: createSubmitMod.formatMentionsFailureForDialog,
				getAvatarColor: avatarMod.getAvatarColor,
				setupWhoTooltips: tooltipTapMod.setupWhoTooltips,
			});`;
			const body = code
				.slice(bodyStart)
				.replace('const deps = await loadDeps();', 'const deps = bundledCommentsThreadDeps;');
			if (body.includes('loadDeps()')) {
				throw new Error('Could not remove creationCommentsThread dependency loader');
			}
			return { code: `${imports}\n${deps}\n${body}`, map: null };
		},
	};
}

function htmlStringImports() {
	return {
		name: "html-string-imports",
		async load(id) {
			if (!id.endsWith(".html")) return null;
			this.addWatchFile(id);
			const source = await fs.readFile(id, "utf8");
			return `export default ${JSON.stringify(source)};`;
		}
	};
}

function emitImportedCss() {
	const cssSources = new Map();
	return {
		name: "emit-imported-css",
		buildStart() {
			cssSources.clear();
			return fs.rm(buildDir, { recursive: true, force: true });
		},
		async load(id) {
			if (!id.endsWith(".css")) return null;
			this.addWatchFile(id);
			cssSources.set(id, await fs.readFile(id, "utf8"));
			return "export default {};";
		},
		generateBundle() {
			const source = [...cssSources.values()].join("\n\n");
			const minified = new CleanCSS({ level: 1 }).minify(source);
			if (minified.errors.length) throw new Error(minified.errors.join("\n"));
			this.emitFile({ type: "asset", name: "app.css", source: minified.styles });
		},
		async writeBundle(_options, bundle) {
			const jsFile = Object.keys(bundle).find((fileName) => fileName.endsWith(".js"));
			const cssFile = Object.keys(bundle).find((fileName) => fileName.endsWith(".css"));
			if (!jsFile || !cssFile) throw new Error("Rollup did not produce the app JavaScript and CSS assets");
			const appBuild = createHash("sha256").update(bundle[jsFile].code).digest("hex").slice(0, 12);
			await fs.writeFile(path.join(buildDir, "manifest.json"), JSON.stringify({ js: jsFile, css: cssFile, appBuild }, null, 2) + "\n", "utf8");
		}
	};
}

export default {
	input: path.join(vpsDir, "client", "app.js"),
	output: {
		dir: buildDir,
		format: "es",
		entryFileNames: "app.[hash].js",
		assetFileNames: "app.[hash][extname]"
	},
	plugins: [
		resolveBundledWwwImports(),
		resolveWwwRootImports(),
		staticallyBundleRouteCardGroupMedia(),
		staticallyBundleCreationCommentsThread(),
		staticallyBundleDynamicImports(),
		assertVpsClientBoundary(),
		htmlStringImports(),
		emitImportedCss(),
		terser(),
	]
};
