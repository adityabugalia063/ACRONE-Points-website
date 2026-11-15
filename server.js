/**
 * Root Server Entry Point
 * Exports the application handler for Vercel and Node.js hosting environments.
 */

import app, { createServer, router } from './server/index.js';
import { config } from './server/config.js';

export { app, createServer, router };
export default app;

// If executed directly (e.g. node server.js)
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const server = createServer();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 Collection Server running at http://localhost:${config.port}`);
  });
}
