import { createRequestHandler } from '../server/app.js';

const handler = createRequestHandler();

export default function vercelHandler(request, response) {
  const parsedUrl = new URL(request.url, 'http://localhost');
  const routePath = Array.isArray(request.query?.path)
    ? request.query.path.join('/')
    : request.query?.path ?? parsedUrl.searchParams.get('path');

  request.url = routePath ? `/api/${routePath}` : parsedUrl.pathname;
  return handler(request, response);
}
