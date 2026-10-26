import Fastify from 'fastify';
import qs from 'qs';
import { mockAdsRoutes } from '../../src/mock/ads.js';
import { mockBitrixRoutes } from '../../src/mock/bitrix-api.js';
import type { MockStore } from '../../src/mock/store.js';

export const MOCK_TOKEN = 'test-webhook-token';
export const ADS_TOKEN = 'test-ads-token';

/** Mock Bitrix24 + рекламный кабинет на случайном порту - sync ходит в них по настоящему HTTP. */
export async function startMockServer(store: MockStore, opts: { rateLimitRps?: number } = {}) {
  const app = Fastify({ routerOptions: { querystringParser: (s) => qs.parse(s, { arrayLimit: 1000, depth: 5 }) } });
  await app.register(mockBitrixRoutes, { prefix: '/mock', store, token: MOCK_TOKEN, rateLimitRps: opts.rateLimitRps ?? 1000 });
  await app.register(mockAdsRoutes, { prefix: '/mock/ads', token: ADS_TOKEN, seed: store.seed, clock: () => store.now() });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    webhookUrl: `${address}/mock/rest/1/${MOCK_TOKEN}/`,
    adsUrl: `${address}/mock/ads`,
    close: () => app.close(),
  };
}
