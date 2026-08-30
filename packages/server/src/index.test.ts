import { describe, expect, test } from 'bun:test';
import { app } from './index';

describe('GET /health', () => {
    test('returns ok status', async () => {
        const res = await app.request('/health');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'ok' });
    });
});
