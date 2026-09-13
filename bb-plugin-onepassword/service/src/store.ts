import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type {
  CredentialRequest,
  Mapping,
  Status,
  JobResult,
} from "./schema.js";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export function matches(value: string, expectedHash: string) {
  const a = Buffer.from(hash(value), "hex"),
    b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export class Store {
  db: DatabaseSync;
  constructor(
    dir: string,
    private key: Buffer,
  ) {
    if (key.length !== 32) throw Error("Encryption key must be 32 bytes.");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const file = join(dir, "onepassword.sqlite");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY,client TEXT NOT NULL,idem TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(client,idem));
   CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY,purpose TEXT NOT NULL,binding TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY,at INTEGER NOT NULL,event TEXT NOT NULL,subject TEXT NOT NULL);
  `);
    // A restarted service never replays an execution with an uncertain outcome.
    for (const r of this.all())
      if (["approved", "running"].includes(r.status))
        this.transition(r.id, [r.status], "failed", {
          ok: false,
          exitCode: null,
          output: "",
          summary:
            "Service restarted. Check the destination before requesting another run.",
        });
    this.db.exec("DELETE FROM challenges; DELETE FROM sessions;");
  }
  get<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key) as
      { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  del(key: string) {
    this.db.prepare("DELETE FROM kv WHERE key=?").run(key);
  }
  encrypt(value: string) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
  }
  decrypt(value: string) {
    const b = Buffer.from(value, "base64");
    const d = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(
      "utf8",
    );
  }
  token() {
    const t = this.get<string>("token");
    return t ? this.decrypt(t) : null;
  }
  setToken(token: string) {
    this.set("token", this.encrypt(token));
    for (const r of this.all())
      if (["pending", "approved", "running"].includes(r.status))
        this.transition(r.id, [r.status], "cancelled");
    this.audit("connection.changed", "1password");
  }
  mappings() {
    return this.get<Mapping[]>("mappings") ?? [];
  }
  saveMapping(mapping: Mapping) {
    const all = this.mappings().filter((m) => m.id !== mapping.id);
    all.push(mapping);
    this.set("mappings", all);
    for (const r of this.all())
      if (
        r.mapping.id === mapping.id &&
        ["pending", "approved"].includes(r.status)
      )
        this.transition(r.id, [r.status], "cancelled");
    this.audit("mapping.saved", mapping.id);
  }
  audit(event: string, subject: string) {
    this.db
      .prepare("INSERT INTO audit(at,event,subject) VALUES(?,?,?)")
      .run(Date.now(), event, subject);
    this.db.exec(
      "DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 2000)",
    );
  }
  all() {
    return (
      this.db
        .prepare("SELECT body FROM requests ORDER BY rowid DESC")
        .all() as { body: string }[]
    ).map((r) => JSON.parse(r.body) as CredentialRequest);
  }
  request(id: string) {
    const row = this.db
      .prepare("SELECT body FROM requests WHERE id=?")
      .get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as CredentialRequest) : null;
  }
  duplicate(client: string, idem: string) {
    const row = this.db
      .prepare("SELECT body FROM requests WHERE client=? AND idem=?")
      .get(client, idem) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as CredentialRequest) : null;
  }
  insert(r: CredentialRequest) {
    this.db
      .prepare("INSERT INTO requests VALUES(?,?,?,?,?,?)")
      .run(
        r.id,
        r.clientId,
        r.input.idempotencyKey,
        r.status,
        r.expiresAt,
        JSON.stringify(r),
      );
    this.audit("request.created", r.id);
    this.db.exec(
      "DELETE FROM requests WHERE state NOT IN ('pending','approved','running') AND id NOT IN (SELECT id FROM requests ORDER BY rowid DESC LIMIT 500)",
    );
  }
  transition(id: string, from: Status[], state: Status, result?: JobResult) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = this.request(id);
      if (!r || !from.includes(r.status)) {
        this.db.exec("ROLLBACK");
        return null;
      }
      if (
        (r.status === "pending" || r.status === "approved") &&
        r.expiresAt <= Date.now() &&
        state !== "expired"
      ) {
        state = "expired";
        result = undefined;
      }
      r.status = state;
      if (state === "running") r.startedAt = Date.now();
      if (!["pending", "approved", "running"].includes(state))
        r.endedAt = Date.now();
      if (result) r.result = result;
      if (!["pending", "approved", "running"].includes(state)) {
        this.del("browser:" + id);
        this.del("action:" + id);
        this.del("totp:" + id);
      }
      this.db
        .prepare("UPDATE requests SET state=?,body=? WHERE id=?")
        .run(state, JSON.stringify(r), id);
      this.audit("request." + state, id);
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  expire() {
    for (const r of this.all()) {
      if (
        ["pending", "approved"].includes(r.status) &&
        r.expiresAt <= Date.now()
      )
        this.transition(r.id, [r.status], "expired");
      if (
        r.status === "running" &&
        r.startedAt! + r.mapping.maxSeconds * 1000 + 30000 <= Date.now()
      )
        this.transition(r.id, ["running"], "failed", {
          ok: false,
          exitCode: null,
          output: "",
          summary:
            "Worker did not finish before the deadline. Check the destination.",
        });
    }
    this.db.prepare("DELETE FROM challenges WHERE expires < ?").run(Date.now());
    this.db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  }
  challenge(purpose: string, binding: string, value: string) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO challenges VALUES(?,?,?,?,?)")
      .run(id, purpose, binding, value, Date.now() + 300000);
    return id;
  }
  takeChallenge(id: string, purpose: string, binding: string) {
    const row = this.db
      .prepare(
        "DELETE FROM challenges WHERE id=? AND purpose=? AND binding=? AND expires>? RETURNING challenge",
      )
      .get(id, purpose, binding, Date.now()) as
      { challenge: string } | undefined;
    return row?.challenge;
  }
  session() {
    const token = secret();
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?)")
      .run(hash(token), Date.now() + 900000);
    return token;
  }
  authenticated(token: string) {
    return !!this.db
      .prepare("SELECT hash FROM sessions WHERE hash=? AND expires>?")
      .get(hash(token), Date.now());
  }
  logout(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE hash=?").run(hash(token));
  }
  close() {
    this.db.close();
  }
}
