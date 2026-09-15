import { it, expect, vi } from "vitest";
import { controlRelay, connectControlRelay } from "../src/control-relay";
it("authenticates one controller, orders input, rechecks locks and cleans up", async () => {
  let locked = false;
  const applied: string[] = [];
  const reset = vi.fn(async () => {}),
    stopped = vi.fn();
  const relay = await controlRelay(
    async (events) => {
      if (locked) throw Error("Private login active");
      await new Promise((r) => setTimeout(r, 5));
      applied.push((events[0] as { text: string }).text);
      return { cursor: "pointer" };
    },
    reset,
    stopped,
  );
  try {
    await expect(
      connectControlRelay({ ...relay, token: "wrong" }),
    ).rejects.toThrow();
    const client = await connectControlRelay(relay);
    await expect(connectControlRelay(relay)).rejects.toThrow();
    const results = await Promise.all(
      ["one", "two", "three"].map((text, i) =>
        client.send({ seq: i, events: [{ kind: "text", text }] }),
      ),
    );
    expect(applied).toEqual(["one", "two", "three"]);
    expect(results.map((r) => r.seq)).toEqual([0, 1, 2]);
    locked = true;
    expect(
      await client.send({
        seq: 4,
        events: [{ kind: "text", text: "blocked" }],
      }),
    ).toMatchObject({ error: expect.stringContaining("Private login active") });
    expect(applied).toHaveLength(3);
    client.close();
    await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    expect(stopped).toHaveBeenCalledTimes(1);
  } finally {
    relay.stop();
  }
});
it("does not replay an input after its connection fails", async () => {
  const applied = vi.fn();
  let finish: () => void = () => {};
  const relay = await controlRelay(
    async () => {
      applied();
      await new Promise<void>((r) => (finish = r));
      return {};
    },
    async () => {},
    () => {},
  );
  try {
    const client = await connectControlRelay(relay);
    const response = client.send({ seq: 1, events: [{ kind: "heartbeat" }] });
    const failure = expect(response).rejects.toThrow("closed");
    await vi.waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
    relay.stop();
    finish();
    await failure;
    expect(applied).toHaveBeenCalledTimes(1);
  } finally {
    finish();
    relay.stop();
  }
});
it('rejects unsupported commands before they reach browser control',async()=>{
 const run=vi.fn(async()=>({}));const relay=await controlRelay(run,async()=>{},()=>{});
 try{const client=await connectControlRelay(relay);await expect(client.send({seq:1,events:[{kind:'cdp',method:'Runtime.evaluate'}]} as never)).rejects.toThrow('closed');expect(run).not.toHaveBeenCalled();}finally{relay.stop();}
});
