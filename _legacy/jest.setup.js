/**
 * Jest setup (unit + integration). Loads .env, then strips Supabase credentials for
 * unit tests so `npm test` never writes to your project DB when .env has SUPABASE_* set.
 *
 * Integration tests: `RUN_INTEGRATION_TESTS=true npm run test:int`
 */
import 'dotenv/config';

const allowIntegration = String(process.env.RUN_INTEGRATION_TESTS || '').toLowerCase() === 'true';
if (!allowIntegration) {
	delete process.env.SUPABASE_URL;
	delete process.env.SUPABASE_ANON_KEY;
	delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}
