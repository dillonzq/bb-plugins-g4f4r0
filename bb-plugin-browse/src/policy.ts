const commands = new Set([
  "upload",
  "frame",
  "open",
  "back",
  "forward",
  "reload",
  "snapshot",
  "click",
  "dblclick",
  "type",
  "fill",
  "press",
  "keyboard",
  "hover",
  "focus",
  "check",
  "uncheck",
  "select",
  "choose",
  "date",
  "drag",
  "scroll",
  "scrollintoview",
  "wait",
  "get",
  "is",
  "eval",
  "set",
  "network",
  "cookies",
  "storage",
  "dialog",
  "console",
  "errors",
  "a11y",
]);
const forbidden =
  /^--(?:session|namespace|cdp|auto-connect|provider|profile|config|restore|executable-path|extensions|init-script|plugin|args|stream|download-path|screenshot-dir|action-policy|confirm|allowed-domains|engine|headed|pin-tab|no-pin-tab|model|state|session-name|enable)(?:=|$)/;
export function validateCommand(args: string[]) {
  if (!commands.has(args[0]))
    throw new Error(
      `Command ${args[0]} is not available here. Use the plugin's session, capture, recording, or download actions.`,
    );
  for (const a of args) {
    if (forbidden.test(a) || a === "-p")
      throw new Error(
        "Connection and runtime flags are managed by Browse.",
      );
  }
  if (args[0] === "get" && args[1] === "cdp-url")
    throw new Error("Private browser endpoints are not returned.");
  if (args[0] === "diff" && args[1] === "screenshot")
    throw new Error("Use the screenshot action to save captures.");
}
export function safeUrl(value: string) {
  if (value === "about:blank") return value;
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol))
    throw new Error("Enter an http:// or https:// URL.");
  return u.href;
}
export function redact(value: string, endpoint?: string) {
  return (
    endpoint ? value.split(endpoint).join("[private browser endpoint]") : value
  ).replace(/wss?:\/\/[^\s"'<>]+/g, "[private browser endpoint]");
}
