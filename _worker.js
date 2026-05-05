export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const response = await env.ASSETS.fetch(request);

    if (!url.pathname.startsWith("/ruleta")) {
      return response;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return response;
    }

    const html = await response.text();
    const injected = html.replace(
      "<head>",
      `<head><script>window.__SUPABASE_URL=${JSON.stringify(env.SUPABASE_URL || "")};window.__SUPABASE_ANON_KEY=${JSON.stringify(env.SUPABASE_ANON_KEY || "")};</script>`,
    );

    return new Response(injected, {
      status: response.status,
      headers: response.headers,
    });
  },
};
