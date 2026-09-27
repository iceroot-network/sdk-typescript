// Checks the SDK against the native Rust vectors in any JavaScript context.
//
// A classic script with no imports, so it loads the same way in Node, a page, a Manifest V3 sandbox
// page, a service worker and a Tauri webview. It defines one global, IceRootVectorChecks, whose
// run(sdk, vectors, context) returns a report instead of throwing, so each context can send the
// report back to the test.
//
// With a test build (sdk.testing present), signatures and signed transactions are also compared
// byte for byte, because the test build can sign with the vectors' fixed auxiliary bytes. With the
// published build, the vectors' signatures and transactions must verify, tampered signatures must
// not, fresh signatures must verify, and freshly signed transactions must carry the native
// unsigned bytes and verify.

(function () {
  "use strict";

  var RELAY = "http://127.0.0.1:4003/api";
  var ALGORITHM = "secp256k1-bip340-sha256";

  function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    var text = "";
    for (var i = 0; i < bytes.length; i++) {
      text += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    }
    return text;
  }

  function tamper(hex) {
    var last = parseInt(hex.slice(-2), 16) ^ 1;
    return hex.slice(0, -2) + (last < 16 ? "0" : "") + last.toString(16);
  }

  function run(sdk, vectors, context) {
    var report = {
      context: context,
      checks: 0,
      failures: [],
      fixedAuxSignatures: 0,
      verifiedSignatures: 0,
      freshSignatures: 0,
      phraseAccounts: 0,
      fixedAuxTransactions: 0,
      verifiedTransactions: 0,
      freshTransactions: 0,
      hasFixedAux: Boolean(sdk.testing && sdk.testing.hasFixedAux()),
    };

    function check(name, expected, actual) {
      report.checks += 1;
      if (expected !== actual) {
        report.failures.push({ check: name, expected: String(expected), actual: String(actual) });
      }
      return expected === actual;
    }

    function attempt(name, f) {
      try {
        f();
      } catch (error) {
        report.checks += 1;
        report.failures.push({ check: name, expected: "no error", actual: String(error && error.stack || error) });
      }
    }

    var profiles = {};
    function profile(networkByte) {
      if (!profiles[networkByte]) {
        profiles[networkByte] = sdk.profiles.devnet({ relays: [RELAY], networkByte: networkByte });
      }
      return profiles[networkByte];
    }

    attempt("initialized", function () {
      check("initialized", true, sdk.isInitialized());
    });

    vectors.keys.forEach(function (keyCase, keyIndex) {
      attempt("key " + keyIndex, function () {
        var networks = Object.keys(keyCase.addresses);
        networks.forEach(function (network) {
          var account = sdk.Keys.fromLegacyPassphrase(keyCase.passphrase, profile(Number(network)));
          check("key " + keyIndex + " public key", keyCase.publicKey, account.publicKey);
          check("key " + keyIndex + " address " + network, keyCase.addresses[network], account.address);
          check("key " + keyIndex + " legacy", true, account.legacy);
          account.release();
        });

        // The same key from the passphrase's bytes; the array is wiped.
        var bytes = new TextEncoder().encode(keyCase.passphrase);
        var fromBytes = sdk.Keys.fromLegacyPassphrase(bytes, profile(90));
        check("key " + keyIndex + " address from bytes", keyCase.addresses["90"], fromBytes.address);
        check("key " + keyIndex + " bytes wiped", true, bytes.every(function (b) { return b === 0; }));
        fromBytes.release();

        var account = sdk.Keys.fromLegacyPassphrase(keyCase.passphrase, profile(90));
        keyCase.signatures.forEach(function (sigCase, sigIndex) {
          var name = "key " + keyIndex + " signature " + sigIndex;
          var message = hexToBytes(sigCase.message);
          var signed = {
            message: message,
            publicKey: keyCase.publicKey,
            signature: sigCase.signature,
            algorithm: ALGORITHM,
            network: "heartwood-devnet-v90",
          };
          if (check(name + " verifies", true, sdk.Messages.verify(signed, profile(90)))) {
            report.verifiedSignatures += 1;
          }
          check(name + " tampered fails", false, sdk.Messages.verify(Object.assign({}, signed, { signature: tamper(sigCase.signature) })));
          check(name + " other message fails", false, sdk.Messages.verify(Object.assign({}, signed, { message: sigCase.message + "00" })));

          var fresh = sdk.Messages.sign(account, message);
          check(name + " fresh signature verifies", true, sdk.Messages.verify(Object.assign({}, signed, { signature: fresh.signature })));
          check(name + " fresh signature network", "heartwood-devnet-v90", fresh.network);
          report.freshSignatures += 1;

          if (report.hasFixedAux) {
            var fixed = sdk.testing.signMessageWithAux(account, message, hexToBytes(sigCase.aux));
            if (check(name + " bytes", sigCase.signature, fixed)) {
              report.fixedAuxSignatures += 1;
            }
            check(name + " digest", sigCase.digest, sdk.testing.sha256(message));
          }
        });
        account.release();
        var released = "no error";
        try {
          sdk.Messages.sign(account, "after release");
        } catch (error) {
          released = error.code;
        }
        check("key " + keyIndex + " released", "KeyReleased", released);
      });
    });

    vectors.addressChecks.forEach(function (addressCase, index) {
      attempt("address check " + index, function () {
        var result = sdk.Address.check(addressCase.text, profile(addressCase.network));
        var name = "address check " + index + " (" + JSON.stringify(addressCase.text) + ")";
        check(name + " ok", addressCase.ok, result.ok);
        if (addressCase.ok) {
          var parsed = sdk.Address.parse(addressCase.text, profile(addressCase.network));
          check(name + " bytes", addressCase.bytes, bytesToHex(parsed.bytes));
          check(name + " network", addressCase.network, parsed.network);
        } else {
          check(name + " reason", addressCase.reason, result.reason);
          check(name + " position", addressCase.position === null ? undefined : addressCase.position, result.position);
          var thrown;
          try {
            sdk.Address.parse(addressCase.text, profile(addressCase.network));
          } catch (error) {
            thrown = error;
          }
          check(name + " throws InvalidAddress", true, thrown instanceof sdk.InvalidAddress);
        }
      });
    });

    vectors.publicKeyAddresses.forEach(function (keyCase, index) {
      attempt("public key address " + index, function () {
        var address = sdk.Address.fromPublicKey(keyCase.publicKey, profile(keyCase.network));
        check("public key address " + index, keyCase.address, address.toString());
      });
    });

    (vectors.phraseAccounts || []).forEach(function (phraseCase, index) {
      attempt("phrase account " + index, function () {
        var name = "phrase account " + index + " (" + phraseCase.path + ")";
        var options = { account: phraseCase.account, index: phraseCase.index, passphrase: phraseCase.passphrase };
        var account = sdk.Keys.fromPhrase(phraseCase.phrase, profile(90), options);
        check(name + " public key", phraseCase.publicKey, account.publicKey);
        check(name + " address", phraseCase.address, account.address);
        check(name + " path", phraseCase.path, account.path);
        check(name + " not legacy", false, account.legacy);
        account.release();
        var bytes = new TextEncoder().encode(phraseCase.phrase);
        var fromBytes = sdk.Keys.fromPhrase(bytes, profile(90), options);
        check(name + " address from bytes", phraseCase.address, fromBytes.address);
        check(name + " bytes wiped", true, bytes.every(function (b) { return b === 0; }));
        fromBytes.release();
        report.phraseAccounts += 1;
      });
    });

    (vectors.phraseChecks || []).forEach(function (phraseCase, index) {
      attempt("phrase check " + index, function () {
        var result = sdk.Mnemonic.check(phraseCase.text);
        var name = "phrase check " + index;
        check(name + " ok", phraseCase.ok, result.ok);
        check(name + " words", phraseCase.words, result.words);
        check(name + " reason", phraseCase.reason, result.reason);
        check(name + " position", phraseCase.position, result.position);
      });
    });

    if (vectors.amounts) {
      vectors.amounts.parse.forEach(function (amountCase, index) {
        attempt("amount parse " + index, function () {
          var name = "amount parse " + index + " (" + JSON.stringify(amountCase.text) + ")";
          var outcome;
          try {
            outcome = sdk.Amount.parse(amountCase.text, amountCase.decimals).toString();
          } catch (error) {
            outcome = error.code;
          }
          check(name, amountCase.units !== undefined ? amountCase.units : amountCase.error, outcome);
        });
      });
      vectors.amounts.format.forEach(function (formatCase, index) {
        attempt("amount format " + index, function () {
          var options = { grouping: formatCase.grouping };
          if (formatCase.maxFraction !== null) {
            options.maxFraction = formatCase.maxFraction;
          }
          check("amount format " + index, formatCase.text, sdk.Amount.format(BigInt(formatCase.units), formatCase.decimals, options));
        });
      });
    }

    if (vectors.transactions) {
      checkTransactions(sdk, vectors.transactions, report, check, attempt, profile(90));
    }

    report.ok = report.failures.length === 0 && report.checks > 0;
    return report;
  }

  function signer(sdk, description, profile) {
    if (description === null || description === undefined) {
      return undefined;
    }
    if (description.legacyPassphrase !== undefined) {
      return sdk.Keys.fromLegacyPassphrase(description.legacyPassphrase, profile);
    }
    return sdk.Keys.fromPhrase(description.phrase, profile, { account: description.account, index: description.index });
  }

  // The request of a vector in the wrapper's shape: amounts become bigint.
  function request(json) {
    var operation = json.operation;
    var converted;
    switch (operation.kind) {
      case "transfer":
        converted = {
          kind: "transfer",
          to: operation.to.map(function (recipient) {
            return { address: recipient.address, amount: BigInt(recipient.amount) };
          }),
        };
        break;
      case "burn":
        converted = { kind: "burn", amount: BigInt(operation.amount) };
        break;
      default:
        converted = operation;
    }
    var result = { operation: converted, fee: BigInt(json.fee.amount) };
    if (json.memo !== null) {
      result.memo = json.memo;
    }
    return result;
  }

  // An operation of a summary in the vectors' shape: amounts as decimal strings.
  function operationText(operation) {
    return JSON.stringify(operation, function (_key, value) {
      return typeof value === "bigint" ? value.toString() : value;
    });
  }

  function checkTransactions(sdk, data, report, check, attempt, devnet) {
    var chain;
    attempt("chain", function () {
      chain = sdk.Chain.load(devnet, data.configuration);
      check("chain nethash", data.nethash, chain.nethash);
      check("chain pinned", data.nethash, chain.profile.chain.nethash);
      check("chain decimals", 8, chain.token.decimals);
    });
    if (chain === undefined) {
      return;
    }
    data.cases.forEach(function (txCase) {
      attempt("transaction " + txCase.name, function () {
        var name = "transaction " + txCase.name;
        var account = signer(sdk, txCase.signer, chain);
        var second = signer(sdk, txCase.secondSigner, chain);
        var facts = { sender: account, nonce: BigInt(txCase.facts.nonce), height: txCase.facts.height };
        if (txCase.facts.secondKey !== null) {
          facts.secondKey = txCase.facts.secondKey;
        }
        var draft = sdk.Draft.build(chain, request(txCase.request), facts);
        var summary = draft.summary;
        check(name + " kind", txCase.summary.kind, summary.kind);
        check(name + " operation", JSON.stringify(txCase.summary.operation), operationText(summary.operation));
        check(name + " from", txCase.summary.from, summary.from);
        check(name + " nonce", txCase.summary.nonce, summary.nonce.toString());
        check(name + " fee", txCase.summary.fee, summary.fee.amount.toString());
        check(name + " fee source", txCase.summary.feeSource, summary.fee.source);
        check(name + " amount", txCase.summary.amount, summary.amount.toString());
        check(name + " total", String(BigInt(txCase.summary.amount) + BigInt(txCase.summary.fee)), summary.total.toString());
        check(name + " size", txCase.summary.size, summary.size);
        check(name + " second signature", txCase.summary.secondSignature, summary.secondSignature);
        check(name + " unsigned bytes", txCase.unsigned, bytesToHex(draft.unsignedBytes));

        // Built here, serialized, and read back as another context would.
        var again = sdk.Draft.deserialize(draft.serialize(), chain.profile);
        check(name + " draft round trip", txCase.unsigned, bytesToHex(again.unsignedBytes));
        check(name + " draft round trip summary", JSON.stringify(summary.lines), JSON.stringify(again.summary.lines));

        // The native signed transaction verifies here and has the native id.
        var native = sdk.SignedTransaction.fromJson(chain, txCase.json, txCase.facts.height);
        check(name + " native id", txCase.id, native.id);
        if (check(name + " native verifies", true, native.verified)) {
          report.verifiedTransactions += 1;
        }

        var options = second === undefined ? {} : { secondKey: second };
        var fresh = again.sign(account, options);
        check(name + " fresh verifies", true, fresh.verified);
        check(name + " fresh carries the unsigned bytes", txCase.unsigned, bytesToHex(fresh.bytes).slice(0, txCase.unsigned.length));
        var back = sdk.SignedTransaction.deserialize(fresh.serialize(), chain.profile);
        check(name + " fresh round trip", fresh.id, back.id);
        if (second !== undefined) {
          check(name + " fresh second signature", true, fresh.verifySecondSignature(second.publicKey));
        }
        report.freshTransactions += 1;

        if (report.hasFixedAux) {
          var signed = sdk.testing.signDraftWithAux(draft, account, hexToBytes(txCase.aux), second);
          check(name + " id", txCase.id, signed.id);
          check(name + " bytes", txCase.bytes, bytesToHex(signed.bytes));
          check(name + " json", JSON.stringify(txCase.json), JSON.stringify(signed.json));
          check(name + " draft sha256", txCase.draftSha256, sdk.testing.sha256(draft.serialize()));
          if (check(name + " signed sha256", txCase.signedSha256, sdk.testing.sha256(signed.serialize()))) {
            report.fixedAuxTransactions += 1;
          }
        }
        account.release();
        if (second !== undefined) {
          second.release();
        }
      });
    });
  }

  globalThis.IceRootVectorChecks = { run: run };
})();
