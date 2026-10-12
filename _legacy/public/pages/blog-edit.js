/**
 * Blog post editor (loaded from pages/blog-edit.html).
 */

function getBlogPostIdFromPath() {
	const m = window.location.pathname.match(/^\/create\/blog\/(\d+)/);
	return m ? parseInt(m[1], 10) : 0;
}

function setMessage(el, text) {
	if (el) el.textContent = text || "";
}

async function loadProfile() {
	const res = await fetch("/api/profile", { credentials: "include" });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) return null;
	return data;
}

async function loadAuthorOptions() {
	const res = await fetch("/api/blog/author-options", { credentials: "include" });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.error || "Failed to load authors");
	return Array.isArray(data.users) ? data.users : [];
}

async function loadPost(id) {
	const res = await fetch(`/api/blog/posts/${id}`, { credentials: "include" });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.error || "Failed to load post");
	return data.post;
}

async function savePost(id, payload) {
	const res = await fetch(`/api/blog/posts/${id}`, {
		method: "PATCH",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.error || "Save failed");
	return data.post;
}

async function deletePost(id) {
	const res = await fetch(`/api/blog/posts/${id}`, { method: "DELETE", credentials: "include" });
	if (res.status === 204) return;
	const data = await res.json().catch(() => ({}));
	throw new Error(data?.error || "Delete failed");
}

async function postLifecycle(id, action) {
	const res = await fetch(`/api/blog/posts/${id}/${action}`, { method: "POST", credentials: "include" });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.error || `${action} failed`);
	return data.post;
}

/** Map desired status to existing POST endpoints. */
async function applyBlogStatus(id, from, to) {
	if (from === to) return null;
	if (to === "published") {
		return postLifecycle(id, "publish");
	}
	if (to === "archived") {
		return postLifecycle(id, "archive");
	}
	if (to === "draft") {
		return postLifecycle(id, "unpublish");
	}
	throw new Error("Invalid status");
}

function normalizeStatus(raw) {
	const s = String(raw || "").toLowerCase();
	if (s === "draft" || s === "published" || s === "archived") return s;
	return "draft";
}

function encodeBlogSlugPath(slug) {
	const s = typeof slug === "string" ? slug.trim() : String(slug ?? "").trim();
	if (!s) return "";
	return s
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg))
		.join("/");
}

async function main() {
	const id = getBlogPostIdFromPath();
	const msg = document.querySelector("[data-blog-message]");
	const form = document.querySelector("[data-blog-form]");
	if (!id || !form) {
		setMessage(msg, "Invalid editor URL.");
		return;
	}

	const titleEl = form.querySelector("[data-blog-title]");
	const slugEl = form.querySelector("[data-blog-slug]");
	const descEl = form.querySelector("[data-blog-description]");
	const bodyEl = form.querySelector("[data-blog-body]");
	const statusSelect = form.querySelector("[data-blog-status]");
	const authorRow = document.querySelector("[data-blog-author-row]");
	const authorSelect = form.querySelector("[data-blog-author]");
	const headingEl = document.querySelector("[data-blog-heading]");

	form.addEventListener("submit", (e) => {
		e.preventDefault();
	});
	titleEl?.addEventListener("input", () => {
		if (!headingEl) return;
		const t = titleEl.value.trim();
		headingEl.textContent = t || "Edit post";
	});

	let isAdmin = false;
	try {
		const profile = await loadProfile();
		isAdmin = profile?.role === "admin";
	} catch (_) {
		isAdmin = false;
	}

	/** Last status confirmed by server (for reverting the dropdown on error). */
	let committedStatus = "draft";

	let post;
	try {
		post = await loadPost(id);
		titleEl.value = post.title || "";
		slugEl.value = post.slug || "";
		descEl.value = post.description || "";
		bodyEl.value = post.body_md || "";
		if (headingEl) {
			const t = (post.title || "").trim();
			headingEl.textContent = t || "Edit post";
		}
		committedStatus = normalizeStatus(post.status);
		if (statusSelect) statusSelect.value = committedStatus;
	} catch (e) {
		setMessage(msg, e?.message || "Could not load post.");
		return;
	}

	if (isAdmin && authorRow && authorSelect) {
		try {
			const users = await loadAuthorOptions();
			const ids = new Set(users.map((u) => Number(u.id)));
			authorSelect.innerHTML = "";
			for (const u of users) {
				const opt = document.createElement("option");
				opt.value = String(u.id);
				opt.textContent = u.label || `User ${u.id}`;
				authorSelect.appendChild(opt);
			}
			const cur = post.author_user_id != null ? Number(post.author_user_id) : NaN;
			if (Number.isFinite(cur) && !ids.has(cur)) {
				const opt = document.createElement("option");
				opt.value = String(cur);
				opt.textContent = `Current author (id ${cur})`;
				authorSelect.appendChild(opt);
			}
			if (Number.isFinite(cur)) authorSelect.value = String(cur);
			authorRow.hidden = false;
		} catch (e) {
			setMessage(msg, e?.message || "Could not load author list.");
		}
	}

	statusSelect?.addEventListener("change", async () => {
		const next = normalizeStatus(statusSelect.value);
		const from = committedStatus;
		if (next === from) return;
		setMessage(msg, "Updating status…");
		try {
			const updated = await applyBlogStatus(id, from, next);
			if (updated) {
				committedStatus = normalizeStatus(updated.status);
				statusSelect.value = committedStatus;
			}
			setMessage(msg, "");
		} catch (e) {
			statusSelect.value = committedStatus;
			setMessage(msg, e?.message || "Could not update status.");
		}
	});

	const saveBtn = document.querySelector("[data-blog-save]");
	saveBtn?.addEventListener("click", async () => {
		setMessage(msg, "Saving…");
		try {
			const payload = {
				title: titleEl.value.trim(),
				slug: slugEl.value.trim(),
				description: descEl.value.trim(),
				body_md: bodyEl.value
			};
			if (isAdmin && authorSelect && authorRow && !authorRow.hidden && authorSelect.value) {
				payload.author_user_id = parseInt(authorSelect.value, 10);
			}
			const saved = await savePost(id, payload);
			if (headingEl) {
				const t = (saved.title || titleEl.value || "").trim();
				headingEl.textContent = t || "Edit post";
			}
			committedStatus = normalizeStatus(saved.status);
			if (statusSelect) statusSelect.value = committedStatus;
			setMessage(msg, "Saved.");
		} catch (e) {
			setMessage(msg, e?.message || "Save failed.");
		}
	});

	const previewBtn = document.querySelector("[data-blog-preview]");
	previewBtn?.addEventListener("click", () => {
		const slugRaw = slugEl?.value?.trim() || "";
		if (!slugRaw) {
			setMessage(msg, "Set a URL slug before opening preview.");
			return;
		}
		const pathSeg = encodeBlogSlugPath(slugRaw);
		if (!pathSeg) {
			setMessage(msg, "Invalid slug.");
			return;
		}
		setMessage(msg, "");
		window.open(`/blog/${pathSeg}?preview=1`, "_blank", "noopener,noreferrer");
	});

	const deleteBtn = document.querySelector("[data-blog-delete]");
	deleteBtn?.addEventListener("click", async () => {
		const titleHint = (titleEl?.value || post?.title || "").trim() || "this post";
		if (
			!window.confirm(
				`Delete “${titleHint}” permanently? This removes the post and its view analytics for this post.`
			)
		) {
			return;
		}
		setMessage(msg, "Deleting…");
		if (deleteBtn) deleteBtn.disabled = true;
		try {
			await deletePost(id);
			window.location.href = "/create#blog";
		} catch (e) {
			setMessage(msg, e?.message || "Could not delete.");
			if (deleteBtn) deleteBtn.disabled = false;
		}
	});
}

main().catch(() => {});
