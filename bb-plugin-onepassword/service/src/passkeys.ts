import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { Store } from "./store.js";
type Saved = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: WebAuthnCredential["transports"];
};
export class Passkeys {
  readonly rpID: string;
  constructor(
    private store: Store,
    private origin: string,
  ) {
    this.rpID = new URL(origin).hostname;
  }
  credentials() {
    return this.store.get<Saved[]>("passkeys") ?? [];
  }
  async registration() {
    const options = await generateRegistrationOptions({
      rpName: "1Password for BB · community integration",
      rpID: this.rpID,
      userName: "owner",
      userDisplayName: "Service owner",
      userID: new TextEncoder().encode("owner"),
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      excludeCredentials: this.credentials().map((c) => ({
        id: c.id,
        transports: c.transports,
      })),
    });
    return {
      options,
      challengeId: this.store.challenge("register", "owner", options.challenge),
    };
  }
  async register(challengeId: string, response: RegistrationResponseJSON) {
    const challenge = this.store.takeChallenge(
      challengeId,
      "register",
      "owner",
    );
    if (!challenge) throw Error("Challenge expired.");
    const verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      requireUserVerification: true,
    });
    if (!verified.verified || !verified.registrationInfo)
      throw Error("Verification failed.");
    const credential = verified.registrationInfo.credential;
    // First-device enrollment is single-use, including concurrent registration responses.
    if (this.credentials().length) throw Error("An owner is already enrolled.");
    this.store.set("passkeys", [
      {
        ...credential,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      },
    ]);
    this.store.audit("owner.enrolled", credential.id);
  }
  async options(purpose: string, binding: string) {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: "required",
      allowCredentials: this.credentials().map((c) => ({
        id: c.id,
        transports: c.transports,
      })),
    });
    return {
      options,
      challengeId: this.store.challenge(purpose, binding, options.challenge),
    };
  }
  async verify(
    purpose: string,
    binding: string,
    challengeId: string,
    response: AuthenticationResponseJSON,
  ) {
    const challenge = this.store.takeChallenge(challengeId, purpose, binding),
      saved = this.credentials().find((c) => c.id === response.id);
    if (!challenge || !saved)
      throw Error("Challenge expired or credential unknown.");
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      requireUserVerification: true,
      credential: {
        ...saved,
        publicKey: Buffer.from(saved.publicKey, "base64url"),
      },
    });
    if (!result.verified) throw Error("Verification failed.");
    this.store.set(
      "passkeys",
      this.credentials().map((c) =>
        c.id === saved.id
          ? { ...c, counter: result.authenticationInfo.newCounter }
          : c,
      ),
    );
  }
}
