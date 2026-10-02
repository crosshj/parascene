function base64url(bytes) {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function encryptThreadText(body, secret) {
	const encoder = new TextEncoder();
	const hash = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
	const key = await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt']);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const packed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(body));
	return `enc:v1:${base64url(iv)}.${base64url(new Uint8Array(packed))}`;
}
