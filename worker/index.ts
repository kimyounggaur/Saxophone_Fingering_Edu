import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return Response.redirect(new URL("/site/index.html", request.url), 302);
    }

    const response = await handler.fetch(request, env, ctx);
    if (response.status === 404) {
      return env.ASSETS.fetch(request);
    }
    return response;
  },
};
