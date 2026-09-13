import { z } from "zod";
import { stateSchema } from "./contracts";
export function serviceOrigin(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.origin !== value || u.username || u.password)
    throw Error(
      "Use the exact HTTPS origin of your approval service, without a path.",
    );
  return u.origin;
}
export class ServiceClient {
  constructor(
    private origin: string,
    private token: string,
  ) {
    serviceOrigin(origin);
  }
  async call(path: string, body?: unknown) {
    try {
      const r = await fetch(this.origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + this.token,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        if (r.status === 401)
          throw Error(
            "The BB client token was rejected. Check 1Password plugin settings.",
          );
        if (r.status === 403)
          throw Error(
            "This project or destination is not authorized by the approval service.",
          );
        if (r.status === 409)
          throw Error(
            "The request or session is unavailable. Check the approval service.",
          );
        if (r.status === 429)
          throw Error(
            "Too many active requests. Complete or cancel an existing request.",
          );
        throw Error("The approval service could not complete the request.");
      }
      const text = await r.text();
      if (text.length > 1000000)
        throw Error("Approval service response too large.");
      return JSON.parse(text);
    } catch (error) {
      if (
        (error instanceof Error && error.message.startsWith("The ")) ||
        (error instanceof Error && error.message.startsWith("This ")) ||
        (error instanceof Error && error.message.startsWith("Too many"))
      )
        throw error;
      throw Error(
        "Cannot reach the approval service. Check its HTTPS address and availability.",
      );
    }
  }
  async state() {
    const [status, mappings, requests] = await Promise.all([
      this.call("/v1/status"),
      this.call("/v1/mappings"),
      this.call("/v1/requests"),
    ]);
    const parsed = z
      .object({
        connected: z.boolean(),
        enrolled: z.boolean(),
        approvalOrigin: z.string(),
      })
      .parse(status);
    if (parsed.approvalOrigin !== this.origin)
      throw Error("Approval service origin does not match settings.");
    return stateSchema.parse({
      configured: true,
      available: true,
      ...parsed,
      error: null,
      mappings: mappings.mappings,
      requests: requests.requests,
    });
  }
}
