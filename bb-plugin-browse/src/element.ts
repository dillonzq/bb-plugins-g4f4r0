import { setTimeout as sleep } from "node:timers/promises";
import type { Cdp } from "./cdp";
import type { Operation } from "./contracts";
import { elementExpression, deepQuerySource } from "./observe";
import { drawStrokes } from "./gesture";

type ElementOp = Extract<Operation, { kind: "element" }>;
/** Retry only preconditions. Never replay an input event that may have reached the page. */
export async function actOnElement(
  c: Pick<Cdp, "evaluate" | "send">,
  op: ElementOp,
  signal: AbortSignal,
) {
  const deadline = Date.now() + op.waitMs;
  let e: any;
  for (;;) {
    signal.throwIfAborted();
    try {
      e = await c.evaluate(elementExpression(op.selector, op.action));
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/AB_WAIT:/.test(message) || Date.now() >= deadline) throw error;
      await sleep(Math.min(80, Math.max(1, deadline - Date.now())), undefined, {
        signal,
      });
    }
  }
  signal.throwIfAborted();
  if (op.action === "fill") {
    if (op.value === undefined) throw new Error("Fill needs a value.");
    // Selection and target checks happen together; input goes to this exact focused field.
    await c.evaluate(
      `(()=>{${deepQuerySource}const a=deepQuery(${JSON.stringify(op.selector)});if(a.length!==1)throw new Error('Target changed before fill');const e=a[0];if(e!==globalThis[${JSON.stringify(e.token)}])throw new Error('Target changed before fill');delete globalThis[${JSON.stringify(e.token)}];if(e.matches(':disabled')||e.readOnly||e.closest('[inert],[aria-disabled="true"]'))throw new Error('Field is disabled or read-only');e.focus({preventScroll:true});let focused=document.activeElement;while(focused?.shadowRoot?.activeElement)focused=focused.shadowRoot.activeElement;if(focused!==e)throw new Error('Field did not receive focus');if(typeof e.select==='function')e.select();else{const range=document.createRange();range.selectNodeContents(e);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);}})()`,
    );
    await c.send("Input.insertText", { text: op.value });
    const value = await c.evaluate(
      `(()=>{${deepQuerySource}const a=deepQuery(${JSON.stringify(op.selector)});if(a.length!==1)throw new Error('Target changed after fill');return a[0].value??a[0].textContent;})()`,
    );
    if (value !== op.value)
      throw new Error(
        "Field did not retain the requested value. Inspect before retrying.",
      );
  } else if (op.action === "hover") {
    await c.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: e.x,
      y: e.y,
      buttons: 0,
    });
  } else {
    await drawStrokes(
      c,
      { kind: "gesture", strokes: [[{ x: e.x, y: e.y }]], intervalMs: 0 },
      signal,
    );
  }
  return `Element ${op.action} completed.`;
}
