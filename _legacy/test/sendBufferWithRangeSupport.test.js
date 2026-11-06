import { describe, expect, test, jest } from '@jest/globals';
import { sendBufferWithRangeSupport } from '../api_routes/utils/sendBufferWithRangeSupport.js';

function mockRes() {
	const headers = {};
	return {
		statusCode: 200,
		body: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		setHeader(name, value) {
			headers[name.toLowerCase()] = value;
		},
		send(data) {
			this.body = data;
			return this;
		},
		end() {
			return this;
		},
		headers,
	};
}

describe('sendBufferWithRangeSupport', () => {
	test('full response includes Accept-Ranges and Content-Length', () => {
		const res = mockRes();
		const buf = Buffer.from('hello-world');
		sendBufferWithRangeSupport(res, buf, { contentType: 'video/mp4' });
		expect(res.statusCode).toBe(200);
		expect(res.headers['accept-ranges']).toBe('bytes');
		expect(res.headers['content-length']).toBe(String(buf.length));
		expect(res.body.equals(buf)).toBe(true);
	});

	test('range request returns 206 partial content', () => {
		const res = mockRes();
		const buf = Buffer.from('0123456789');
		sendBufferWithRangeSupport(res, buf, {
			contentType: 'video/mp4',
			rangeHeader: 'bytes=2-5',
		});
		expect(res.statusCode).toBe(206);
		expect(res.headers['content-range']).toBe('bytes 2-5/10');
		expect(res.body.toString()).toBe('2345');
	});
});
