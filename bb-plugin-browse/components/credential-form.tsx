import { useRef, useState } from "react";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { Button } from "./ui/button";

const payloadSchema = z.object({
  origin: z.string().url(),
  purpose: z.string(),
  fields: z.array(
    z.object({
      label: z.string(),
      kind: z.enum(["username", "password", "one-time-code"]),
    }),
  ),
});
export function CredentialForm({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = payloadSchema.safeParse(interaction.payload);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false);
  if (!parsed.success)
    return (
      <p>
        Invalid credential request.{" "}
        <Button onClick={() => void cancel()}>Cancel</Button>
      </p>
    );
  const { origin, purpose, fields } = parsed.data;
  return (
    <form
      key={interaction.id}
      autoComplete="on"
      className="space-y-3 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (locked.current) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        const values = fields.map((_, i) =>
          String(data.get(`credential-${i}`) ?? ""),
        );
        locked.current = true;
        setBusy(true);
        setError("");
        try {
          await submit(values);
          form.reset();
        } catch {
          form.reset();
          setError("Could not submit. Try a fresh request.");
        } finally {
          values.fill("");
          locked.current = false;
          setBusy(false);
        }
      }}
    >
      <div>
        <strong>Sign in to {new URL(origin).host}</strong>
        <p className="text-sm text-muted-foreground break-all">{origin}</p>
      </div>
      <p className="text-sm">{purpose}</p>
      <p className="text-sm text-muted-foreground">
        Use AutoFill → Passwords to choose 1Password. If the login is for
        another website, select it manually and choose Allow Once.
      </p>
      {fields.map((field, i) => (
        <label key={i} className="block text-sm space-y-1">
          <span>{field.label}</span>
          <input
            name={`credential-${i}`}
            aria-label={field.label}
            required
            maxLength={4096}
            type={field.kind === "username" ? "text" : "password"}
            autoComplete={
              field.kind === "password" ? "current-password" : field.kind
            }
            inputMode={field.kind === "one-time-code" ? "numeric" : undefined}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            readOnly={busy}
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground"
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        Fills this browser page and clicks its continue button. Values stay out
        of chat and are not saved to an env file.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Fill and continue"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void cancel()}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
