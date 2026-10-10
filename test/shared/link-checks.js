// Shared account-link vectors through the public API, with fixed randomness in test builds.
export function runLinks(sdk, glue, records, equal) {
  const profile = sdk.profiles.devnet({ relays: ["https://node.example/api"] });
  const original = glue.KeyHandle.prototype.signLink;
  glue.KeyHandle.prototype.signLink = function (message, now) {
    return this.signLinkWithAux(message, now, new Uint8Array(32).fill(0x42));
  };
  let count = 0;
  const reasons = new Set();
  try {
    for (const vector of records) {
      if (vector.op === "meta") continue;
      const i = vector.input;
      let output;
      let failure;
      try {
        switch (vector.op) {
          case "link.build": {
            const request = { ...i, issuedAt: new Date(i.issuedAt * 1000) };
            output = { message: i.kind === "revocation"
              ? sdk.Link.buildRevocation({ ...request, endsLinkIssuedAt: new Date(i.endsLinkIssuedAt * 1000) }, profile)
              : sdk.Link.build(request, profile) };
            break;
          }
          case "link.parse": output = sdk.Link.parse(i.message, profile, i.expected ?? {}, i.now); break;
          case "link.verify": output = sdk.Link.verify(i.record, profile, i.expected ?? {}, i.now); break;
          case "link.history":
            sdk.Link.checkHistory(i.message, profile, i.recorded, i.now);
            output = { accepted: true }; break;
          case "link.sign": {
            const key = sdk.Keys.fromLegacyPassphrase(i.passphrase, profile);
            try {
              const record = sdk.Link.sign(key, i.message, { now: i.now });
              output = { record, json: sdk.Link.toJson(record) };
              equal(JSON.stringify(record), output.json, vector.name + " record bytes");
              equal(sdk.Link.fromJson(output.json), record, vector.name + " round trip");
              sdk.Link.verify(output.json, profile, {}, i.now);
            } finally { key.release(); }
            break;
          }
          case "message.sign": {
            const key = sdk.Keys.fromLegacyPassphrase(i.passphrase, profile);
            try { output = { signature: sdk.testing.signMessageWithAux(key, i.message, new Uint8Array(32).fill(0x42)) }; }
            finally { key.release(); }
            break;
          }
          default: throw new Error("unknown vector operation " + vector.op);
        }
      } catch (error) {
        if (error.code === "InvalidLink") {
          equal(error instanceof sdk.InvalidLink, true, vector.name + " error class");
          equal(error.reason, error.details.reason, vector.name + " reason");
          reasons.add(error.reason);
        }
        failure = { class: error.code, details: error.details };
      }
      equal(failure ?? output, vector.error ?? vector.output, vector.name);
      count++;
    }
    equal(count, 113, "all records run");
    equal(reasons.size, 15, "all refusal reasons run");
    return count;
  } finally { glue.KeyHandle.prototype.signLink = original; }
}
