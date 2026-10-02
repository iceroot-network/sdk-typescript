import { Link, InvalidLink, type LinkRecord, type LinkProblem, type Account, type NetworkProfile } from "../../dist/web/index.js";

declare const account: Account;
declare const profile: NetworkProfile;
const now = new Date();
const message = Link.build({ githubId: 9999999001, publicKey: account.publicKey, issuedAt: now }, profile);
const record: LinkRecord = Link.sign(account, message, { now });
Link.verify(Link.toJson(record), profile, { kind: "link" }, now);
Link.buildRevocation({ githubId: 9999999001, publicKey: account.publicKey, issuedAt: now, endsLinkIssuedAt: now }, profile);
const reason: LinkProblem = new InvalidLink("future").reason;
void reason;
// @ts-expect-error Numeric ids cannot be supplied as text.
Link.build({ githubId: "9999999001", publicKey: account.publicKey, issuedAt: now }, profile);
// @ts-expect-error The signer clock is required.
Link.sign(account, message);
// @ts-expect-error A revocation must name the ended link.
Link.buildRevocation({ githubId: 9999999001, publicKey: account.publicKey, issuedAt: now }, profile);
