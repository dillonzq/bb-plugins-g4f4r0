// Local dummy login fixture. Never use a real account credential here.
import { createServer } from "node:http";
const port = Number(process.argv[2] ?? 43822);
const page = `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>BB browser login test</title><body style="font:18px system-ui;max-width:480px;margin:60px auto;padding:20px"><h1>BB browser login test</h1><p>Dummy credentials only. This does not connect to Shopify or a 1Password vault.</p><form method="post" action="/login"><p><label>Demo email <input id="email" name="email" autocomplete="username" required></label></p><p><label>Demo password <input id="password" type="password" name="password" autocomplete="current-password" required></label></p><button type="submit">Sign in</button></form></body></html>`;
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method === "POST" && req.url === "/login") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) { res.writeHead(413); res.end("Too much data"); return; }
    }
    const form = new URLSearchParams(body);
    const matches = form.get("email") === "demo@example.test" && form.get("password") === "bb-demo-only";
    body = "";
    if (matches) {
      res.writeHead(303, { Location: "/success", "Set-Cookie": "bb_browser_demo=ok; HttpOnly; SameSite=Strict; Path=/" }); res.end();
    } else { res.writeHead(303, { Location: "/try-again" }); res.end(); }
    return;
  }
  if (req.url === "/success" && req.headers.cookie?.includes("bb_browser_demo=ok")) {
    res.end('<!doctype html><title>Demo signed in</title><h1>Demo signed in</h1><p>The private BB form delivered the dummy login to this remote browser.</p>'); return;
  }
  res.end(page);
});
server.listen(port, "127.0.0.1", () => console.log(`Dummy browser login fixture ready on loopback port ${port}. Expires in one hour.`));
function close() { server.closeAllConnections(); server.close(); }
const expiry = setTimeout(close, 3600000); expiry.unref();
process.once("SIGTERM", close); process.once("SIGINT", close);
