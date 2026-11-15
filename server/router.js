import url from 'node:url';

export class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  use(fn) {
    this.middlewares.push(fn);
  }

  get(path, ...handlers) {
    this.addRoute('GET', path, handlers);
  }

  post(path, ...handlers) {
    this.addRoute('POST', path, handlers);
  }

  options(path, ...handlers) {
    this.addRoute('OPTIONS', path, handlers);
  }

  addRoute(method, path, handlers) {
    // Convert path with params like /api/players/:id to regex
    const paramNames = [];
    const regexPath = path.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const regex = new RegExp(`^${regexPath}$`);

    this.routes.push({
      method: method.toUpperCase(),
      path,
      regex,
      paramNames,
      handlers
    });
  }

  async handle(req, res) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    req.path = parsedUrl.pathname || '/';
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());
    req.params = {};

    // Helper: res.json
    res.json = (data, statusCode = 200) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(data));
    };

    // Helper: res.status
    res.status = (code) => {
      res.statusCode = code;
      return {
        json: (data) => res.json(data, code),
        send: (text) => {
          res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(text);
        }
      };
    };

    // Run middlewares
    for (const mw of this.middlewares) {
      let nextCalled = false;
      let errOccurred = null;

      try {
        await new Promise((resolve, reject) => {
          mw(req, res, (err) => {
            if (err) return reject(err);
            nextCalled = true;
            resolve();
          });
        });
      } catch (err) {
        errOccurred = err;
      }

      if (errOccurred) {
        console.error('Middleware Error:', errOccurred);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: errOccurred.message });
      }

      if (!nextCalled && res.writableEnded) {
        return; // Handled by middleware (e.g. 401 auth rejected)
      }
    }

    // Match route
    const reqMethod = req.method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== reqMethod && route.method !== 'ALL') continue;

      const match = req.path.match(route.regex);
      if (match) {
        // Extract params
        const params = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
        }
        req.params = params;

        // Execute handlers chain
        for (const handler of route.handlers) {
          let nextCalled = false;
          let errOccurred = null;

          try {
            await new Promise((resolve, reject) => {
              const ret = handler(req, res, (err) => {
                if (err) return reject(err);
                nextCalled = true;
                resolve();
              });
              // Support async handlers that return a Promise without calling next()
              if (ret && typeof ret.then === 'function') {
                ret.then(() => resolve()).catch(reject);
              }
            });
          } catch (err) {
            errOccurred = err;
          }

          if (errOccurred) {
            console.error('Route Handler Error:', errOccurred);
            const status = errOccurred.code === 'INSUFFICIENT_QUANTITY' ? 400 : 500;
            return res.status(status).json({
              error: errOccurred.code || 'HANDLER_ERROR',
              message: errOccurred.message
            });
          }

          if (res.writableEnded || !nextCalled) {
            return;
          }
        }
        return;
      }
    }

    // No route matched
    return null;
  }
}
