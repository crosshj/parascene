const SECTION_DISPLAY_NAMES={about:'About',create:'Create',connect:'Connect',discover:'Discover',credits:'Credits',privacy:'Privacy',terms:'Terms',ungrouped:''};
import express from 'express';import path from 'node:path';import fs from 'node:fs/promises';import {marked} from 'marked';
function parseFrontmatter(content) {
	const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
	const match = content.match(frontmatterRegex);

	if (match) {
		const frontmatterText = match[1];
		const body = match[2];
		const metadata = {};

		// Simple YAML-like parsing for title, description, and beta flag
		for (const line of frontmatterText.split('\n')) {
			const colonIndex = line.indexOf(':');
			if (colonIndex > 0) {
				const key = line.slice(0, colonIndex).trim();
				let value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
				// Handle boolean values
				if (value === 'true') {
					value = true;
				} else if (value === 'false') {
					value = false;
				}
				metadata[key] = value;
			}
		}

		return { metadata, body };
	}

	return { metadata: {}, body: content };
}
function stripSegmentPrefix(segment) {
	return segment.replace(/^\d+-/, '');
}
function stripPathPrefix(pathStr) {
	const normalized = pathStr.replace(/\\/g, '/');
	return normalized.split('/').map(stripSegmentPrefix).join('/');
}
async function scanHelpDirectory(dir, baseDir, section = '') {
	const fs = await import("fs/promises");
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const helpFiles = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);

		if (entry.isDirectory() && !entry.name.startsWith('_')) {
			// Recursively scan subdirectories (section keeps raw name for sort order)
			const subSection = section ? `${section}/${entry.name}` : entry.name;
			const subFiles = await scanHelpDirectory(fullPath, baseDir, subSection);
			helpFiles.push(...subFiles);
		} else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_') && entry.name.toLowerCase() !== 'index.md') {
			// Process markdown file (exclude index.md from nav - it serves the help home)
			const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
			const slug = stripPathPrefix(relativePath).replace(/\.md$/, '');
			const content = await fs.readFile(fullPath, 'utf-8');
			const { metadata, body } = parseFrontmatter(content);

			// Section for display/grouping (prefix stripped); sortSection for ordering (raw). Frontmatter can override.
			// Root-level files use filename (e.g. 05-privacy) as sortSection so numeric prefix controls nav order.
			const rawSection = section || (relativePath.includes('/') ? path.dirname(relativePath) : entry.name.replace(/\.md$/i, ''));
			const fileSection = typeof metadata.section === 'string' && metadata.section.trim()
				? metadata.section.trim()
				: stripPathPrefix(rawSection);
			// Title from filename: strip numeric prefix (e.g. 01-) then format
			const nameWithoutExt = entry.name.replace(/\.md$/i, '');
			const nameForTitle = stripSegmentPrefix(nameWithoutExt);
			const titleFromFilename = nameForTitle.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

			helpFiles.push({
				slug,
				section: fileSection,
				sortSection: rawSection,
				sortFilename: entry.name,
				title: metadata.title || titleFromFilename,
				description: metadata.description || '',
				beta: metadata.beta === true,
				content: body,
				html: marked.parse(body)
			});
		}
	}

	return helpFiles;
}
async function getHelpFiles(helpDir) {
	const helpFiles = await scanHelpDirectory(helpDir, helpDir);

	// Sort by section order (raw prefix), then by filename (raw prefix for file order within section)
	helpFiles.sort((a, b) => {
		if (a.sortSection !== b.sortSection) {
			return (a.sortSection || '').localeCompare(b.sortSection || '');
		}
		return (a.sortFilename || '').localeCompare(b.sortFilename || '');
	});

	return helpFiles;
}
function escapeHtml(text) {
	return String(text || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
function countOccurrences(text, query) {
	if (!text || !query) return 0;
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let count = 0;
	let index = lowerText.indexOf(lowerQuery);
	while (index !== -1) {
		count++;
		index = lowerText.indexOf(lowerQuery, index + 1);
	}
	return count;
}
function searchHelpFiles(helpFiles, query) {
	if (!query || query.trim().length === 0) {
		return [];
	}

	const lowerQuery = query.toLowerCase().trim();
	const results = [];

	for (const file of helpFiles) {
		let totalCount = 0;

		// Count in title
		const titleCount = countOccurrences(file.title, lowerQuery);
		totalCount += titleCount;

		// Count in description
		const descCount = file.description ? countOccurrences(file.description, lowerQuery) : 0;
		totalCount += descCount;

		// Count in content body
		const contentCount = countOccurrences(file.content, lowerQuery);
		totalCount += contentCount;

		if (totalCount > 0) {
			results.push({
				slug: file.slug,
				section: file.section,
				title: file.title,
				description: file.description,
				count: totalCount
			});
		}
	}

	return results;
}
function generateNavigation(helpFiles, currentSlug) {
	// Group files by section
	const sections = new Map();

	for (const file of helpFiles) {
		const sectionName = file.section || 'General';
		if (!sections.has(sectionName)) {
			sections.set(sectionName, []);
		}
		sections.get(sectionName).push({
			slug: file.slug,
			title: file.title,
			active: file.slug === currentSlug
		});
	}

	// Convert to array format
	const navigation = [];
	for (const [sectionName, items] of sections.entries()) {
		navigation.push({
			section: sectionName,
			items
		});
	}

	return navigation;
}
function formatSectionName(section) {
	if (!section) return 'General';
	const name = SECTION_DISPLAY_NAMES[section];
	if (name !== undefined) return name;
	return section.split('/').map(part =>
		SECTION_DISPLAY_NAMES[part] || part.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
	).join(' / ');
}
function renderHelpPage({ title, description = '', articleHtml, files, currentSlug = '', isIndex = false, showOverviewLink = true }) {
	const navigation = generateNavigation(files, currentSlug);
	const navHtml = navigation.map(group => `<section class="help-nav-section${formatSectionName(group.section) ? '' : ' help-nav-section--ungrouped'}">${formatSectionName(group.section) ? `<div class="help-nav-section-title">${escapeHtml(formatSectionName(group.section))}</div>` : ''}${group.items.map(item => `<a class="help-nav-item${item.active ? ' active' : ''}" href="/help/${encodeURIComponent(item.slug)}">${escapeHtml(item.title)}</a>`).join('')}</section>`).join('');
	const fallbackTopics = `<div class="help-index"><h2>Help Topics</h2>${navigation.map(group => `<section class="help-index-section">${formatSectionName(group.section) ? `<h3 class="help-index-section-title">${escapeHtml(formatSectionName(group.section))}</h3>` : ''}<div class="help-index-list">${group.items.map(item => `<div class="help-index-item"><a class="help-index-link" href="/help/${encodeURIComponent(item.slug)}"><h4>${escapeHtml(item.title)}</h4></a></div>`).join('')}</div></section>`).join('')}</div>`;
	const content = isIndex && !articleHtml.trim()
		? `<div class="help-content"><h1>${escapeHtml(title)}</h1>${description ? `<p class="help-description">${escapeHtml(description)}</p>` : ''}${fallbackTopics}</div>`
		: `<div class="help-content"><h1>${escapeHtml(title)}</h1>${description ? `<p class="help-description">${escapeHtml(description)}</p>` : ''}<div class="help-body">${articleHtml}</div></div>`;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="description" content="Help and documentation for parascene."><link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>${escapeHtml(title)} - Help - parascene</title><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/help/assets/tokens.css"><link rel="stylesheet" href="/help/assets/help.css"><style>
		body.help-page{display:flex;flex-direction:column;margin:0;padding-top:72px;min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--font-family);-webkit-font-smoothing:antialiased}.help-site-header{position:fixed;inset:0 0 auto;z-index:100;height:72px;display:flex;align-items:center;border-bottom:1px solid var(--border);background:var(--surface);padding:0 24px}.help-site-header-inner{width:100%;max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}.help-brand-wordmark{font-size:24px;font-weight:750;font-style:italic;letter-spacing:-.065em;color:var(--text)}.help-app-link{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;height:40px;min-height:40px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);background:var(--surface);font-size:.95rem;font-weight:500;line-height:1.2;text-decoration:none;transition:color .2s,background .2s,border-color .2s}.help-app-link:hover{color:var(--accent);background:rgba(124,58,237,.08);border-color:var(--accent)}.help-page main{flex:1;width:100%;max-width:1248px;margin:0 auto;padding:24px}.help-app-link,.help-mobile-home,.help-search-bar input{box-sizing:border-box}.help-mobile-home{height:40px;min-height:40px}.help-search-bar input{height:40px}.site-footer{flex:0 0 auto;padding:48px 24px 32px;text-align:center;border-top:1px solid var(--border);background:var(--surface-muted)}.site-footer-nav{display:flex;flex-wrap:wrap;gap:16px 24px;justify-content:center;margin-bottom:16px}.site-footer-nav a{color:var(--text-muted);text-decoration:none;font-size:.95rem}.site-footer-nav a:hover{color:var(--accent);text-decoration:underline}.site-footer-copy{margin:0;font-size:.85rem;color:var(--text-muted)}
		</style></head><body class="help-page"><header class="help-site-header"><div class="help-site-header-inner"><span class="help-brand-wordmark" aria-label="parascene">parascene</span><a class="help-app-link" href="/">Go to app</a></div></header><main><div class="help-container"><aside class="help-sidebar"><nav class="help-nav">${navHtml}</nav></aside><section class="help-article-wrapper"><div class="help-search-bar">${showOverviewLink ? '<a href="/help" class="help-mobile-home btn-secondary" aria-label="Help home"><svg class="help-mobile-home-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7M5.5 9v11h13V9M9.5 20v-6h5v6"/></svg><span class="help-home-label">Overview</span></a>' : ''}<input type="search" id="help-search" placeholder="Search help..." aria-label="Search help articles"></div><div class="help-article"><div class="help-search-results" id="help-search-results" style="display:none"></div><div class="help-article-content" id="help-article-content">${content}</div></div></section></div></main><footer class="site-footer" role="contentinfo"><nav class="site-footer-nav" aria-label="Footer"><a href="https://www.parascene.com/pricing">Pricing</a><a href="/help/privacy">Privacy Policy</a><a href="/help/terms-of-service">Terms of Service</a></nav><p class="site-footer-copy">&copy; 2026 parascene. All rights reserved.</p></footer><script type="module" src="/help/assets/help.js"></script></body></html>`;
}

export default function createHelpRoutes({pagesDir}){const router=express.Router(),helpDir=path.join(pagesDir,'help');
router.use('/help/assets',express.static(path.join(helpDir,'assets'),{index:false,fallthrough:false}));
router.get(['/help','/help/*'],async(req,res,next)=>{try{const files=await getHelpFiles(helpDir);const slug=decodeURIComponent(String(req.path).replace(/^\/help\/?/,''));const article=slug?files.find(file=>file.slug===slug):null;if(slug&&!article){const html=renderHelpPage({title:'Article Not Found',articleHtml:'<div class="help-not-found"><p class="help-not-found-message">The help article you are looking for does not exist or may have moved. Try searching or browsing the sidebar.</p></div>',files});return res.status(404).type('html').send(html)}let title='Help',description='',html='';if(article){title=article.title;description=article.description;html=article.html}else{const index=await fs.readFile(path.join(helpDir,'index.md'),'utf8');const parsed=parseFrontmatter(index);title=parsed.metadata.title||title;description=parsed.metadata.description||'';html=marked.parse(parsed.body)}res.type('html').send(renderHelpPage({title,description,articleHtml:html,files,currentSlug:slug,isIndex:!slug,showOverviewLink:Boolean(slug)}));}catch(error){next(error)}});
router.get('/api/help',async(req,res,next)=>{try{const files=await getHelpFiles(helpDir),slug=String(req.query.slug||'');let article=files.find(f=>f.slug===slug);if(!slug){const {metadata,body}=parseFrontmatter(await fs.readFile(path.join(helpDir,'index.md'),'utf8'));article={slug:'',title:metadata.title||'Help',html:marked.parse(body)}}if(!article)return res.status(404).json({error:'Article not found'});res.json({article,navigation:generateNavigation(files,slug)});}catch(error){next(error)}});
router.get('/api/help/search',async(req,res,next)=>{try{res.json({results:searchHelpFiles(await getHelpFiles(helpDir),String(req.query.q||''))})}catch(error){next(error)}});return router;}
