/**
 * MSW test server setup.
 *
 * Used by vitest to intercept requests in tests. Start it in a test setup file
 * and reset handlers between tests.
 */
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
