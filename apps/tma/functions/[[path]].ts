export interface PagesEnv {
  ASTRODEX_SERVER?: {
    fetch: (request: Request | string, init?: RequestInit) => Promise<Response>;
  };
}

const PROXIED_PREFIXES = ["/v1/", "/tg/", "/mcp", "/openapi.json", "/llms.txt", "/health"];

export async function onRequest(context: {
  request: Request;
  env: PagesEnv;
  next: () => Promise<Response>;
}): Promise<Response> {
  const url = new URL(context.request.url);
  const shouldProxy = PROXIED_PREFIXES.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(prefix),
  );
  if (!shouldProxy) {
    return context.next();
  }
  if (!context.env.ASTRODEX_SERVER) {
    return Response.json(
      { ok: false, error: "ASTRODEX_SERVER service binding is not configured." },
      { status: 503 },
    );
  }
  return context.env.ASTRODEX_SERVER.fetch(context.request);
}
