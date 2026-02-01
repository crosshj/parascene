import { getBaseAppUrl } from "../api_routes/utils/url.js";

const html = String.raw;

const BRAND_NAME = "parascene";
const BRAND_COLOR = "#0f172a";
const ACCENT_COLOR = "#7c3aed";

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function renderImpersonationBar({ originalRecipient, reason } = {}) {
	if (!originalRecipient) return "";
	const safeName = escapeHtml(originalRecipient?.name || "Unknown");
	const safeEmail = escapeHtml(originalRecipient?.email || "unknown");
	const safeUserId = escapeHtml(
		Number.isFinite(Number(originalRecipient?.userId)) ? Number(originalRecipient.userId) : "unknown"
	);
	const safeReason = escapeHtml(reason || "Suppressed recipient");

	return html`
    <tr>
      <td style="background:#fff7ed; border-bottom:1px solid #ea580c; padding:12px 24px; text-align:left;">
        <div style="color:#9a3412; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin:0 0 6px;">
          Delegated delivery
        </div>
        <div style="color:#7c2d12; font-size:13px; line-height:1.6;">
          <div><strong>Original recipient</strong>: ${safeName} (${safeEmail})</div>
          <div><strong>User ID</strong>: ${safeUserId}</div>
          <div><strong>Reason</strong>: ${safeReason}</div>
        </div>
      </td>
    </tr>
  `;
}

// Base email layout function
// ctaText: Text for the call-to-action button (e.g., "Visit Us", "View the creation")
// ctaUrl: Full URL for the CTA link (e.g., "https://parascene.crosshj.com" or "https://parascene.crosshj.com/creations/123")
//         Defaults to base URL (homepage) if not provided
function baseEmailLayout({ preheader, title, bodyHtml, ctaText, ctaUrl = getBaseAppUrl(), footerText, topNotice, suppressCta = false }) {
	const safePreheader = escapeHtml(preheader || "");
	const safeTitle = escapeHtml(title || "");
	const safeFooter = escapeHtml(footerText || `© ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.`);
	const ctaBlock = (!suppressCta && ctaText)
		? html`
      <div style="margin:28px 0 12px; text-align:center;">
        <a href="${ctaUrl}"
           style="background:${ACCENT_COLOR}; color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:18px; font-weight:600; font-size:16px; letter-spacing:0.2px; display:inline-block; min-width:240px; text-align:center;">
          ${escapeHtml(ctaText)}
        </a>
      </div>
    `
		: "";

	const emailNotice =
		topNotice?.type === "impersonation" ?
			`<table role="presentation" cellpadding="0" cellspacing="0" width="100%">
				${renderImpersonationBar(topNotice.data)}
			</table>`
			: "";

	return html`
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0; padding:0; background:#f5f7fb;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
      ${safePreheader}
    </div>
    ${emailNotice}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f7fb; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 10px 30px rgba(15, 23, 42, 0.08);">
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px; color:${BRAND_COLOR}; font-size:24px; line-height:1.3;">
                  ${safeTitle}
                </h1>
                <div style="color:#334155; font-size:15px; line-height:1.7;">
                  ${bodyHtml}
                </div>
                ${ctaBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background:#f8fafc; color:#64748b; font-size:12px; line-height:1.6; text-align:center;">
                ${safeFooter}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

export function renderHelloFromParascene({ recipientName = "there" } = {}) {
	const safeName = escapeHtml(recipientName);
	const subject = "Hello from parascene";
	const preheader = "A quick hello from the parascene team.";
	const bodyHtml = html`
    <p style="margin:0 0 12px;">Hi ${safeName},</p>
    <p style="margin:0 0 12px;">
      Thanks for being part of parascene. We’re building a place to turn prompts into
      scenes that feel cinematic and personal.
    </p>
    <p style="margin:0 0 12px;">
      If you want a quick walkthrough, start with a template or dive straight into creation.
      We’re always here if you need a hand.
    </p>
    <p style="margin:0;">Warmly,<br />The parascene team</p>
  `;
	const emailHtml = baseEmailLayout({
		preheader,
		title: subject,
		bodyHtml,
		ctaText: "Visit Us",
		ctaUrl: getBaseAppUrl(),
		footerText: "You’re receiving this email because you’re connected to parascene."
	});
	const text = [
		`Hi ${recipientName},`,
		"",
		"Thanks for being part of parascene. We’re building a place to turn prompts into scenes that feel cinematic and personal.",
		"",
		"If you want a quick walkthrough, start with a template or dive straight into creation.",
		"",
		"Warmly,",
		"The parascene team"
	].join("\n");

	return { subject, html: emailHtml, text };
}

function truncateMiddle(value, max = 240) {
	const s = String(value ?? "");
	if (s.length <= max) return s;
	const keepStart = Math.max(0, Math.floor(max * 0.7));
	const keepEnd = Math.max(0, max - keepStart - 1);
	return `${s.slice(0, keepStart)}…${s.slice(s.length - keepEnd)}`;
}

// Render comment received email template
// creationUrl: Full URL to the specific creation (e.g., "https://parascene.crosshj.com/creations/123")
//              Defaults to base URL (homepage) if not provided
export function renderCommentReceived({
	recipientName = "there",
	commenterName = "Someone",
	commentText = "",
	creationTitle = "",
	creationUrl = getBaseAppUrl(), // Full URL to creation, falls back to homepage if not provided
	impersonation = null
} = {}) {
	const safeRecipient = escapeHtml(recipientName);
	const safeCommenter = escapeHtml(commenterName);
	const safeTitle = escapeHtml(creationTitle || "your creation");
	const safeComment = escapeHtml(truncateMiddle(commentText, 600));

	const subject = `New comment on ${creationTitle ? creationTitle : "your creation"}`;
	const preheader = `${commenterName || "Someone"} left a comment on ${creationTitle ? creationTitle : "your creation"}.`;

	const bodyHtml = html`
    <p style="margin:0 0 12px;">Hi ${safeRecipient},</p>
    <p style="margin:0 0 12px;">
      <strong>${safeCommenter}</strong> commented on <strong>${safeTitle}</strong>.
    </p>
    <div style="margin:16px 0 0; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#f8fafc;">
      <div style="color:#475569; font-size:13px; margin:0 0 6px;">Comment</div>
      <div style="white-space:pre-wrap; color:#0f172a; font-size:15px; line-height:1.6;">${safeComment}</div>
    </div>
  `;

	const emailHtml = baseEmailLayout({
		preheader,
		title: "You got a comment",
		bodyHtml,
		topNotice: impersonation ? { type: "impersonation", data: impersonation } : null,
		ctaText: "View the creation",
		ctaUrl: creationUrl,
		footerText: "You’re receiving this email because someone commented on your creation."
	});

	const impersonationText = impersonation?.originalRecipient
		? [
			"",
			"--- Delegated delivery ---",
			`Original recipient: ${impersonation.originalRecipient?.name || "Unknown"} (${impersonation.originalRecipient?.email || "unknown"})`,
			`User ID: ${Number.isFinite(Number(impersonation.originalRecipient?.userId))
				? Number(impersonation.originalRecipient.userId)
				: "unknown"
			}`,
			`Reason: ${impersonation.reason || "Suppressed recipient"}`,
			"---"
		].join("\n")
		: "";

	const textLines = [];

	if (impersonationText) {
		textLines.push(impersonationText, "");
	}

	textLines.push(
		`Hi ${recipientName},`,
		"",
		`${commenterName} commented on ${creationTitle || "your creation"}:`,
		"",
		truncateMiddle(commentText, 1200),
		"",
		`View the creation: ${creationUrl}`
	);

	const text = textLines.join("\n");

	return { subject, html: emailHtml, text };
}

export function renderFeatureRequest({
	requesterName = "Someone",
	requesterEmail = "",
	requesterUserId = null,
	requesterUserName = "",
	requesterDisplayName = "",
	requesterRole = "",
	requesterCreatedAt = null,
	message = "",
	userAgent = "",
	acceptLanguage = "",
	referer = "",
	forwardedFor = "",
	ip = "",
	ips = [],
	context = null,
	submittedAt = null
} = {}) {
	const safeRequesterName = escapeHtml(requesterName || "Someone");
	const safeRequesterEmail = escapeHtml(requesterEmail || "unknown");
	const safeUserId = escapeHtml(
		Number.isFinite(Number(requesterUserId)) ? Number(requesterUserId) : "unknown"
	);
	const safeUserName = escapeHtml(requesterUserName || "");
	const safeDisplayName = escapeHtml(requesterDisplayName || "");
	const safeRole = escapeHtml(requesterRole || "");
	const safeUserCreatedAt = escapeHtml(requesterCreatedAt || "");
	const safeMessage = escapeHtml(truncateMiddle(message, 4000));
	const safeUserAgent = escapeHtml(truncateMiddle(userAgent, 280));
	const safeAcceptLanguage = escapeHtml(truncateMiddle(acceptLanguage, 280));
	const safeReferer = escapeHtml(truncateMiddle(referer, 800));
	const safeForwardedFor = escapeHtml(truncateMiddle(forwardedFor, 500));
	const safeIp = escapeHtml(ip || "");
	const safeIps = escapeHtml(Array.isArray(ips) ? ips.filter(Boolean).join(", ") : "");
	const ctx = context && typeof context === "object" ? context : null;
	const safeCtxRoute = escapeHtml(String(ctx?.route || ""));
	const safeCtxTimezone = escapeHtml(String(ctx?.timezone || ""));
	const safeCtxLocale = escapeHtml(String(ctx?.locale || ""));
	const safeCtxPlatform = escapeHtml(String(ctx?.platform || ""));
	const safeCtxColorScheme = escapeHtml(String(ctx?.colorScheme || ""));
	const safeCtxReducedMotion = escapeHtml(String(ctx?.reducedMotion || ""));
	const safeCtxNetwork = escapeHtml(String(ctx?.network || ""));
	const safeCtxViewport = escapeHtml(
		(ctx?.viewportWidth && ctx?.viewportHeight) ? `${ctx.viewportWidth}×${ctx.viewportHeight}` : ""
	);
	const safeCtxScreen = escapeHtml(
		(ctx?.screenWidth && ctx?.screenHeight) ? `${ctx.screenWidth}×${ctx.screenHeight}` : ""
	);
	const safeCtxDpr = escapeHtml(Number.isFinite(Number(ctx?.devicePixelRatio)) ? String(ctx.devicePixelRatio) : "");
	const timestamp = submittedAt ? new Date(submittedAt) : new Date();
	const safeWhen = escapeHtml(timestamp.toISOString());

	const summary = String(message || "")
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean) || "New request";
	const subject = `Feature request: ${truncateMiddle(summary, 80)}`;
	const preheader = `${requesterName || "Someone"} submitted a feature request.`;

	const bodyHtml = html`
		<div style="margin:0 0 14px;">
			<div style="color:#475569; font-size:13px; margin:0 0 6px;">From</div>
			<div style="font-size:15px; line-height:1.6;">
				<strong>${safeRequesterName}</strong> (${safeRequesterEmail})<br />
				<span style="color:#64748b;">User ID:</span> ${safeUserId}<br />
				${(safeUserName || safeDisplayName) ? html`
					<span style="color:#64748b;">Profile:</span>
					${safeDisplayName ? html`<span>${safeDisplayName}</span>` : ""}
					${safeUserName ? html`${safeDisplayName ? html`&nbsp;·&nbsp;` : ""}<span>@${safeUserName}</span>` : ""}
					<br />
				` : ""}
				${safeRole ? html`<span style="color:#64748b;">Role:</span> ${safeRole}<br />` : ""}
				${safeUserCreatedAt ? html`<span style="color:#64748b;">User created:</span> ${safeUserCreatedAt}<br />` : ""}
				<span style="color:#64748b;">Submitted:</span> ${safeWhen}
			</div>
		</div>

		<div style="margin:12px 0 0; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#ffffff;">
			<div style="color:#475569; font-size:13px; margin:0 0 6px;">Details</div>
			<div style="white-space:pre-wrap; color:#0f172a; font-size:15px; line-height:1.7;">${safeMessage}</div>
		</div>

		${(safeCtxRoute || safeReferer || safeIp || safeForwardedFor || safeAcceptLanguage || safeCtxTimezone || safeCtxLocale || safeCtxPlatform || safeCtxViewport || safeCtxScreen || safeCtxDpr || safeCtxColorScheme || safeCtxReducedMotion || safeCtxNetwork) ? html`
			<div style="margin:12px 0 0; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#ffffff;">
				<div style="color:#475569; font-size:13px; margin:0 0 10px;">Context</div>
				<div style="color:#0f172a; font-size:13px; line-height:1.7;">
					${safeCtxRoute ? html`<div><span style="color:#64748b;">Route:</span> ${safeCtxRoute}</div>` : ""}
					${safeReferer ? html`<div><span style="color:#64748b;">Referrer:</span> ${safeReferer}</div>` : ""}
					${safeIp ? html`<div><span style="color:#64748b;">IP:</span> ${safeIp}</div>` : ""}
					${safeIps ? html`<div><span style="color:#64748b;">IPs:</span> ${safeIps}</div>` : ""}
					${safeForwardedFor ? html`<div><span style="color:#64748b;">X-Forwarded-For:</span> ${safeForwardedFor}</div>` : ""}
					${safeAcceptLanguage ? html`<div><span style="color:#64748b;">Accept-Language:</span> ${safeAcceptLanguage}</div>` : ""}
					${safeCtxTimezone ? html`<div><span style="color:#64748b;">Timezone:</span> ${safeCtxTimezone}</div>` : ""}
					${safeCtxLocale ? html`<div><span style="color:#64748b;">Locale:</span> ${safeCtxLocale}</div>` : ""}
					${safeCtxPlatform ? html`<div><span style="color:#64748b;">Platform:</span> ${safeCtxPlatform}</div>` : ""}
					${safeCtxViewport ? html`<div><span style="color:#64748b;">Viewport:</span> ${safeCtxViewport}</div>` : ""}
					${safeCtxScreen ? html`<div><span style="color:#64748b;">Screen:</span> ${safeCtxScreen}</div>` : ""}
					${safeCtxDpr ? html`<div><span style="color:#64748b;">DPR:</span> ${safeCtxDpr}</div>` : ""}
					${safeCtxColorScheme ? html`<div><span style="color:#64748b;">Color scheme:</span> ${safeCtxColorScheme}</div>` : ""}
					${safeCtxReducedMotion ? html`<div><span style="color:#64748b;">Reduced motion:</span> ${safeCtxReducedMotion}</div>` : ""}
					${safeCtxNetwork ? html`<div><span style="color:#64748b;">Network:</span> ${safeCtxNetwork}</div>` : ""}
				</div>
			</div>
		` : ""}

		${userAgent ? html`
			<div style="margin:12px 0 0; padding:14px 16px; border:1px solid #e2e8f0; border-radius:12px; background:#ffffff;">
				<div style="color:#475569; font-size:13px; margin:0 0 6px;">User agent</div>
				<div style="color:#0f172a; font-size:13px; line-height:1.6; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
					${safeUserAgent}
				</div>
			</div>
		` : ""}
	`;

	const emailHtml = baseEmailLayout({
		preheader,
		title: "New feature request",
		bodyHtml,
		suppressCta: true,
		footerText: "You’re receiving this email because you’re the parascene admin."
	});

	const text = [
		"New feature request",
		"",
		`From: ${requesterName || "Someone"} (${requesterEmail || "unknown"})`,
		`User ID: ${Number.isFinite(Number(requesterUserId)) ? Number(requesterUserId) : "unknown"}`,
		(requesterDisplayName || requesterUserName) ? `Profile: ${requesterDisplayName || ""}${(requesterDisplayName && requesterUserName) ? " · " : ""}${requesterUserName ? `@${requesterUserName}` : ""}` : "",
		requesterRole ? `Role: ${requesterRole}` : "",
		requesterCreatedAt ? `User created: ${requesterCreatedAt}` : "",
		`Submitted: ${timestamp.toISOString()}`,
		"",
		"Details:",
		String(message || "").trim(),
		"",
		(ctx?.route ? `Route: ${ctx.route}` : ""),
		referer ? `Referrer: ${referer}` : "",
		ip ? `IP: ${ip}` : "",
		(Array.isArray(ips) && ips.length) ? `IPs: ${ips.join(", ")}` : "",
		forwardedFor ? `X-Forwarded-For: ${forwardedFor}` : "",
		acceptLanguage ? `Accept-Language: ${acceptLanguage}` : "",
		(ctx?.timezone ? `Timezone: ${ctx.timezone}` : ""),
		(ctx?.locale ? `Locale: ${ctx.locale}` : ""),
		(ctx?.platform ? `Platform: ${ctx.platform}` : ""),
		(ctx?.viewportWidth && ctx?.viewportHeight) ? `Viewport: ${ctx.viewportWidth}x${ctx.viewportHeight}` : "",
		(ctx?.screenWidth && ctx?.screenHeight) ? `Screen: ${ctx.screenWidth}x${ctx.screenHeight}` : "",
		Number.isFinite(Number(ctx?.devicePixelRatio)) ? `DPR: ${ctx.devicePixelRatio}` : "",
		(ctx?.colorScheme ? `Color scheme: ${ctx.colorScheme}` : ""),
		(ctx?.reducedMotion ? `Reduced motion: ${ctx.reducedMotion}` : ""),
		(ctx?.network ? `Network: ${ctx.network}` : ""),
		userAgent ? `User agent: ${userAgent}` : ""
	].filter(Boolean).join("\n");

	return { subject, html: emailHtml, text };
}

export const templates = {
	helloFromParascene: renderHelloFromParascene,
	commentReceived: renderCommentReceived,
	featureRequest: renderFeatureRequest
};
