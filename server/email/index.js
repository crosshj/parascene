import { templates } from './templates.js';

function recipientsOf(to) {
	if (Array.isArray(to)) return to.map((item) => String(item || '').trim()).filter(Boolean);
	return typeof to === 'string' && to.trim() ? [to.trim()] : [];
}

export function renderEmailTemplate(templateName, data) {
	const render = templates[templateName];
	if (!render) throw new Error(`Unknown email template: ${templateName}`);
	return render(data);
}

export async function sendTemplatedEmail({ to, template, data, replyTo } = {}) {
	const recipients = recipientsOf(to);
	if (!recipients.length) throw new Error('Email recipient is required.');
	const apiKey = process.env.RESEND_API_KEY;
	const fromAddress = process.env.RESEND_SYSTEM_EMAIL;
	if (!apiKey) throw new Error('Missing required environment variable: RESEND_API_KEY');
	if (!fromAddress) throw new Error('Missing required environment variable: RESEND_SYSTEM_EMAIL');
	const rendered = renderEmailTemplate(template, data);
	const payload = {
		from: `parascene <${fromAddress}>`, to: recipients,
		subject: rendered.subject, html: rendered.html, text: rendered.text
	};
	if (replyTo) payload.reply_to = replyTo;
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	const result = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(`Resend error: ${result.message || response.statusText || response.status}`);
	return result;
}
