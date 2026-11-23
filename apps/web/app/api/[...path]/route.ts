import { ErrorCode, type ErrorResponse } from '@novee/contracts';

// The browser's only way to the API (D13): /api/<path> is forwarded to API_URL/<path>. A route handler rather
// than a next.config rewrite, so API_URL is read when the request arrives, not baked in at build time.

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  const target = new URL(
    `/${path.map(encodeURIComponent).join('/')}`,
    process.env.API_URL ?? 'http://localhost:8080',
  );
  target.search = new URL(request.url).search;
  // A content type only with a body: the API refuses an empty body labelled as JSON (approve has none).
  const body = request.method === 'POST' || request.method === 'PUT' ? await request.text() : '';
  try {
    const response = await fetch(target, {
      method: request.method,
      headers: body === '' ? {} : { 'content-type': 'application/json' },
      body: body === '' ? undefined : body,
      cache: 'no-store',
    });
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    const body: ErrorResponse = {
      error: ErrorCode.Unavailable,
      message: `API unreachable: ${String(error)}`,
    };
    return Response.json(body, { status: 503 });
  }
}

export { forward as GET, forward as POST, forward as PUT };
