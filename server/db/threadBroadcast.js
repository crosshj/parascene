// WWW uses private broadcasts only as hints; clients fetch authoritative data.
export async function broadcastThreadHint(client, topic, payload) {
	const channel = client.channel(topic, { config: { private: true } });
	let timer;
	try {
		await new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error('Realtime subscribe timeout')), 12000);
			let sending = false;
			channel.subscribe((status) => {
				if (status === 'SUBSCRIBED' && !sending) {
					sending = true;
					channel.send({ type: 'broadcast', event: 'dirty', payload }).then((value) => value === 'ok' ? resolve() : reject(new Error(`Broadcast failed: ${value}`)), reject);
				} else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) reject(new Error(status));
			});
		});
	} catch (error) { console.warn('[threads] broadcast failed:', error.message); }
	finally { clearTimeout(timer); await client.removeChannel(channel).catch(() => undefined); }
}
