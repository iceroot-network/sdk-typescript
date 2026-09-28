// Runs the ownership proof vectors (sdk-rust's vectors/sdk/S08-ownership-proofs.jsonl) through the
// SDK in any JavaScript context.
//
// A classic script with no imports, like vector-checks.js. It defines one global,
// IceRootOwnershipChecks, whose run(ownership, testing, records) resolves to a report instead of
// throwing (every call of the SDK is awaited, so it runs on the WebAssembly entry and on the Tauri
// plugin's alike): `ownership` is the ownership entry point of the published build, `testing` the test
// build's seams (for the signing records, which use fixed auxiliary bytes) with the test build's
// ownership entry point as `testing.ownership`, and `records` the file's records without its meta
// line. Every record must match, except the documented ones where the SDK refuses on purpose what
// the Legacy Signer's own checks accept (sdk-rust's runner lists the same cases).

(function () {
  "use strict";

  // The signer reads the source address by its pattern only, the issue time with JavaScript's
  // Date.parse (which rolls impossible dates over), and a typed account with Unicode toLowerCase.
  var STRICTER = [
    "an S address of network byte 62",
    "address with a bad checksum",
    "issued on 30 February",
    "issued on 29 February of a common year",
    "issued at 24:00:00",
    "in capitals with a Kelvin sign for K",
  ];

  function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  /** JSON with object keys sorted, for comparing values whatever their key order. */
  function canonical(value) {
    if (Array.isArray(value)) {
      return "[" + value.map(canonical).join(",") + "]";
    }
    if (value !== null && typeof value === "object") {
      return (
        "{" +
        Object.keys(value)
          .sort()
          .map(function (key) {
            return JSON.stringify(key) + ":" + canonical(value[key]);
          })
          .join(",") +
        "}"
      );
    }
    return JSON.stringify(value);
  }

  async function run(ownership, testing, records) {
    var tally = { matched: 0, divergent: 0 };
    var failures = [];

    function fail(record, message) {
      failures.push((record.name || record.op) + ": " + message);
    }

    /** The output of `f`, or { refused: reason } for an InvalidProof; any other error is kept as a failure. */
    async function outcome(record, f) {
      try {
        return { output: await f() };
      } catch (error) {
        if (error && error.code === "InvalidProof" && error.reason === error.details.reason) {
          return { refused: error.reason };
        }
        return { error: String(error && error.code ? error.code + ": " + error.message : error) };
      }
    }

    function judge(record, result) {
      if (result.error !== undefined) {
        return fail(record, "threw " + result.error);
      }
      if (record.error === undefined) {
        if (result.output !== undefined) {
          if (canonical(result.output) !== canonical(record.output)) {
            return fail(record, "gave " + canonical(result.output) + ", expected " + canonical(record.output));
          }
          tally.matched += 1;
        } else if (STRICTER.indexOf(record.name) >= 0) {
          tally.divergent += 1;
        } else {
          fail(record, "refused (" + result.refused + ") where the vectors accept");
        }
      } else if (result.output !== undefined) {
        fail(record, "accepted where the vectors refuse");
      } else {
        tally.matched += 1;
      }
    }

    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      var input = record.input;
      switch (record.op) {
        case "proof.account":
          judge(
            record,
            await outcome(record, async function () {
              var parsed = await ownership.IceRootAccount.parse(input.text);
              return { account: parsed.account, network: parsed.network };
            }),
          );
          break;
        case "proof.build":
          judge(
            record,
            await outcome(record, async function () {
              return {
                message: await ownership.OwnershipProof.build({
                  address: input.address,
                  account: input.account,
                  nonce: input.nonce,
                  issuedAt: input.issuedAtMs,
                }),
              };
            }),
          );
          break;
        case "proof.parse":
          judge(
            record,
            await outcome(record, async function () {
              var fields = await ownership.OwnershipProof.parse(input.message, input.expected, input.now);
              return Object.assign({ network: ownership.SOURCE_NETWORK }, fields);
            }),
          );
          break;
        case "proof.sign": {
          var key = await testing.ownership.SolarKey.fromPassphrase(input.passphrase);
          try {
            var result = await outcome(record, function () {
              return testing.signProofWithAux(key, input.message, input.now, hexToBytes(input.aux));
            });
            if (result.output !== undefined) {
              var proof = result.output;
              var json = await testing.ownership.OwnershipProof.toJson(proof);
              // The JSON reads back as the same proof, which verifies; the signature alone makes
              // the same proof, as a Ledger's signature is checked; the published build agrees.
              var again = await ownership.OwnershipProof.fromJson(json);
              var fromSignature = await ownership.OwnershipProof.fromSignature(proof.message, proof.publicKey, proof.signature, input.now);
              if (canonical(again) !== canonical(proof) || canonical(fromSignature) !== canonical(proof)) {
                fail(record, "the signed proof does not read back");
              }
              if ((await ownership.OwnershipProof.verify(json, input.now)).address !== key.address) {
                fail(record, "the signed proof does not verify");
              }
              if ((await ownership.sourceAddress(key.publicKey)) !== key.address) {
                fail(record, "the key's address is not its public key's");
              }
              result = { output: { proof: JSON.parse(json), json: json } };
            }
            judge(record, result);
          } finally {
            await key.release();
          }
          break;
        }
        case "proof.verify": {
          var verdict = await outcome(record, function () {
            return ownership.OwnershipProof.verify(JSON.stringify(input.proof), input.now);
          });
          if (verdict.error !== undefined) {
            fail(record, "threw " + verdict.error);
          } else if ((verdict.output !== undefined) !== record.output.valid) {
            fail(record, "verified " + (verdict.output !== undefined) + ", expected " + record.output.valid);
          } else {
            tally.matched += 1;
          }
          break;
        }
        default:
          fail(record, "unknown operation " + record.op);
      }
    }
    return { ok: failures.length === 0, tally: tally, failures: failures };
  }

  globalThis.IceRootOwnershipChecks = { run: run };
})();
