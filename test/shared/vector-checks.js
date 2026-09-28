// Checks the SDK against the native Rust vectors in any JavaScript context.
//
// A classic script with no imports, so it loads the same way in Node, a page, a Manifest V3 sandbox
// page, a service worker and a Tauri webview. It defines one global, IceRootVectorChecks, whose
// run(sdk, vectors, context) resolves to a report instead of throwing, so each context can send the
// report back to the test. Every call of the SDK is awaited, so the same checks run on the
// WebAssembly entry and on the Tauri plugin's entry.
//
// When the context passes the vote library and the keystore too (sdk.vote and sdk.keystore, as the
// classic-script build's global has them), their selections and keystore are checked as well.
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

  async function run(sdk, vectors, context) {
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
      voteSelections: 0,
      keystoresOpened: 0,
      hasFixedAux: Boolean(sdk.testing && sdk.testing.hasFixedAux()),
    };

    function check(name, expected, actual) {
      report.checks += 1;
      if (expected !== actual) {
        report.failures.push({ check: name, expected: String(expected), actual: String(actual) });
      }
      return expected === actual;
    }

    async function attempt(name, f) {
      try {
        await f();
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

    await attempt("initialized", async function () {
      check("initialized", true, sdk.isInitialized());
    });

    for (var keyIndex = 0; keyIndex < vectors.keys.length; keyIndex++) {
      await checkKey(vectors.keys[keyIndex], keyIndex);
    }

    async function checkKey(keyCase, keyIndex) {
      await attempt("key " + keyIndex, async function () {
        var networks = Object.keys(keyCase.addresses);
        for (var n = 0; n < networks.length; n++) {
          var network = networks[n];
          var legacy = await sdk.Keys.fromLegacyPassphrase(keyCase.passphrase, profile(Number(network)));
          check("key " + keyIndex + " public key", keyCase.publicKey, legacy.publicKey);
          check("key " + keyIndex + " address " + network, keyCase.addresses[network], legacy.address);
          check("key " + keyIndex + " legacy", true, legacy.legacy);
          await legacy.release();
        }

        // The same key from the passphrase's bytes; the array is wiped.
        var bytes = new TextEncoder().encode(keyCase.passphrase);
        var fromBytes = await sdk.Keys.fromLegacyPassphrase(bytes, profile(90));
        check("key " + keyIndex + " address from bytes", keyCase.addresses["90"], fromBytes.address);
        check("key " + keyIndex + " bytes wiped", true, bytes.every(function (b) { return b === 0; }));
        await fromBytes.release();

        var account = await sdk.Keys.fromLegacyPassphrase(keyCase.passphrase, profile(90));
        for (var sigIndex = 0; sigIndex < keyCase.signatures.length; sigIndex++) {
          var sigCase = keyCase.signatures[sigIndex];
          var name = "key " + keyIndex + " signature " + sigIndex;
          var message = hexToBytes(sigCase.message);
          var signed = {
            message: message,
            publicKey: keyCase.publicKey,
            signature: sigCase.signature,
            algorithm: ALGORITHM,
            network: "heartwood-devnet-v90",
          };
          if (check(name + " verifies", true, await sdk.Messages.verify(signed, profile(90)))) {
            report.verifiedSignatures += 1;
          }
          check(name + " tampered fails", false, await sdk.Messages.verify(Object.assign({}, signed, { signature: tamper(sigCase.signature) })));
          check(name + " other message fails", false, await sdk.Messages.verify(Object.assign({}, signed, { message: sigCase.message + "00" })));

          var fresh = await sdk.Messages.sign(account, message);
          check(name + " fresh signature verifies", true, await sdk.Messages.verify(Object.assign({}, signed, { signature: fresh.signature })));
          check(name + " fresh signature network", "heartwood-devnet-v90", fresh.network);
          report.freshSignatures += 1;

          if (report.hasFixedAux) {
            var fixed = await sdk.testing.signMessageWithAux(account, message, hexToBytes(sigCase.aux));
            if (check(name + " bytes", sigCase.signature, fixed)) {
              report.fixedAuxSignatures += 1;
            }
            check(name + " digest", sigCase.digest, await sdk.testing.sha256(message));
          }
        }
        await account.release();
        var released = "no error";
        try {
          await sdk.Messages.sign(account, "after release");
        } catch (error) {
          released = error.code;
        }
        check("key " + keyIndex + " released", "KeyReleased", released);
      });
    }

    for (var a = 0; a < vectors.addressChecks.length; a++) {
      await checkAddress(vectors.addressChecks[a], a);
    }

    async function checkAddress(addressCase, index) {
      await attempt("address check " + index, async function () {
        var result = await sdk.Address.check(addressCase.text, profile(addressCase.network));
        var name = "address check " + index + " (" + JSON.stringify(addressCase.text) + ")";
        check(name + " ok", addressCase.ok, result.ok);
        if (addressCase.ok) {
          var parsed = await sdk.Address.parse(addressCase.text, profile(addressCase.network));
          check(name + " bytes", addressCase.bytes, bytesToHex(parsed.bytes));
          check(name + " network", addressCase.network, parsed.network);
        } else {
          check(name + " reason", addressCase.reason, result.reason);
          check(name + " position", addressCase.position === null ? undefined : addressCase.position, result.position);
          var thrown;
          try {
            await sdk.Address.parse(addressCase.text, profile(addressCase.network));
          } catch (error) {
            thrown = error;
          }
          check(name + " throws InvalidAddress", true, thrown instanceof sdk.InvalidAddress);
        }
      });
    }

    for (var k = 0; k < vectors.publicKeyAddresses.length; k++) {
      await checkPublicKeyAddress(vectors.publicKeyAddresses[k], k);
    }

    async function checkPublicKeyAddress(keyCase, index) {
      await attempt("public key address " + index, async function () {
        var address = await sdk.Address.fromPublicKey(keyCase.publicKey, profile(keyCase.network));
        check("public key address " + index, keyCase.address, address.toString());
      });
    }

    var phraseAccounts = vectors.phraseAccounts || [];
    for (var p = 0; p < phraseAccounts.length; p++) {
      await checkPhraseAccount(phraseAccounts[p], p);
    }

    async function checkPhraseAccount(phraseCase, index) {
      await attempt("phrase account " + index, async function () {
        var name = "phrase account " + index + " (" + phraseCase.path + ")";
        var options = { account: phraseCase.account, index: phraseCase.index, passphrase: phraseCase.passphrase };
        var account = await sdk.Keys.fromPhrase(phraseCase.phrase, profile(90), options);
        check(name + " public key", phraseCase.publicKey, account.publicKey);
        check(name + " address", phraseCase.address, account.address);
        check(name + " path", phraseCase.path, account.path);
        check(name + " not legacy", false, account.legacy);
        await account.release();
        var bytes = new TextEncoder().encode(phraseCase.phrase);
        var fromBytes = await sdk.Keys.fromPhrase(bytes, profile(90), options);
        check(name + " address from bytes", phraseCase.address, fromBytes.address);
        check(name + " bytes wiped", true, bytes.every(function (b) { return b === 0; }));
        await fromBytes.release();
        report.phraseAccounts += 1;
      });
    }

    var phraseChecks = vectors.phraseChecks || [];
    for (var c = 0; c < phraseChecks.length; c++) {
      await checkPhrase(phraseChecks[c], c);
    }

    async function checkPhrase(phraseCase, index) {
      await attempt("phrase check " + index, async function () {
        var result = await sdk.Mnemonic.check(phraseCase.text);
        var name = "phrase check " + index;
        check(name + " ok", phraseCase.ok, result.ok);
        check(name + " words", phraseCase.words, result.words);
        check(name + " reason", phraseCase.reason, result.reason);
        check(name + " position", phraseCase.position, result.position);
      });
    }

    if (vectors.amounts) {
      for (var i = 0; i < vectors.amounts.parse.length; i++) {
        await checkParse(vectors.amounts.parse[i], i);
      }
      for (var f = 0; f < vectors.amounts.format.length; f++) {
        await checkFormat(vectors.amounts.format[f], f);
      }
    }

    async function checkParse(amountCase, index) {
      await attempt("amount parse " + index, async function () {
        var name = "amount parse " + index + " (" + JSON.stringify(amountCase.text) + ")";
        var outcome;
        try {
          outcome = (await sdk.Amount.parse(amountCase.text, amountCase.decimals)).toString();
        } catch (error) {
          outcome = error.code;
        }
        check(name, amountCase.units !== undefined ? amountCase.units : amountCase.error, outcome);
      });
    }

    async function checkFormat(formatCase, index) {
      await attempt("amount format " + index, async function () {
        var options = { grouping: formatCase.grouping };
        if (formatCase.maxFraction !== null) {
          options.maxFraction = formatCase.maxFraction;
        }
        check("amount format " + index, formatCase.text, await sdk.Amount.format(BigInt(formatCase.units), formatCase.decimals, options));
      });
    }

    if (vectors.transactions) {
      await checkTransactions(sdk, vectors.transactions, report, check, attempt, profile(90));
    }

    if (sdk.vote && vectors.vote) {
      await checkVote(sdk, vectors.vote, check, attempt, report);
    }
    if (sdk.keystore && vectors.keystore) {
      await checkKeystore(sdk, vectors.keystore, check, attempt, report);
    }
    report.ok = report.failures.length === 0 && report.checks > 0;
    return report;
  }

  async function checkVote(sdk, cases, check, attempt, report) {
    var vote = sdk.vote;
    var snapshot;
    await attempt("vote snapshot", async function () {
      snapshot = vote.VoteSnapshot.deserialize(JSON.stringify(cases.snapshot));
      check("vote snapshot height", cases.snapshot.height, snapshot.height.toString());
    });
    if (snapshot === undefined) {
      return;
    }
    for (var index = 0; index < cases.selections.length; index++) {
      await checkSelection(cases.selections[index], index);
    }

    async function checkSelection(expected, index) {
      var name = "vote " + index + " " + expected.mode;
      await attempt(name, async function () {
        var selection = await vote.select(snapshot, {
          mode: expected.mode,
          account: expected.account,
          draw: expected.draw,
          rules: cases.rules,
        });
        check(name + " seed", expected.seed, selection.seed);
        check(name + " pool", expected.pool, selection.pool);
        check(name + " topped up", expected.toppedUp, selection.toppedUp);
        check(name + " top-up notice", expected.topUpNotice, selection.topUpNotice);
        var entries = selection.entries.map(function (pick) {
          return [pick.validator, pick.basisPoints];
        });
        check(name + " entries", JSON.stringify(expected.entries), JSON.stringify(entries));
        selection.entries.forEach(function (pick) {
          check(name + " reasons", true, pick.reasons.length > 0 && pick.reasons.every(function (reason) {
            return typeof reason.kind === "string" && reason.text.length > 0;
          }));
        });
        check(name + " valid vote", 0, (await vote.validateVote(selection.vote, cases.rules)).length);
        check(name + " still meets", true, (await vote.check(selection, snapshot)).every(function (finding) {
          return finding.stillMeets;
        }));
        report.voteSelections += 1;
      });
    }
    await attempt("vote refusal", async function () {
      try {
        await vote.select(snapshot, { mode: "diversity", account: "holder", count: 19, rules: cases.rules });
        check("vote refusal", "InvalidPickCount", "no error");
      } catch (error) {
        check("vote refusal", "InvalidPickCount", error.code);
        check("vote refusal class", true, error instanceof vote.InvalidPickCount);
      }
    });
  }

  async function checkKeystore(sdk, expected, check, attempt, report) {
    var keystore = sdk.keystore;
    var decoder = new TextDecoder();
    await attempt("keystore", async function () {
      var password = new TextEncoder().encode(expected.password);
      var opened = await keystore.decrypt(hexToBytes(expected.keystore), password);
      check("keystore phrase", expected.phrase, decoder.decode(opened.phrase));
      check("keystore words", expected.words, opened.words);
      check("keystore password wiped", true, password.every(function (b) { return b === 0; }));
      check("keystore text", expected.text, await keystore.armor(hexToBytes(expected.keystore)));
      check("keystore from text", expected.phrase, decoder.decode((await keystore.decrypt(expected.text, expected.password)).phrase));
      try {
        await keystore.decrypt(expected.text, "wrong " + expected.password);
        check("keystore wrong password", "WrongPasswordOrCorrupt", "no error");
      } catch (error) {
        check("keystore wrong password", "WrongPasswordOrCorrupt", error.code);
      }
      // A new keystore at the lowest parameters, read back.
      var low = { memoryKib: 19456, iterations: 2, parallelism: 1 };
      var fresh = await keystore.encrypt(expected.phrase, "fresh password", low);
      check("keystore fresh header", 19456, (await keystore.inspect(fresh)).memoryKib);
      check("keystore fresh phrase", expected.phrase, decoder.decode((await keystore.decrypt(fresh, "fresh password")).phrase));
      report.keystoresOpened += 1;
    });
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
    var result = { operation: converted, fee: json.fee.kind === "minimum" ? "minimum" : BigInt(json.fee.amount) };
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

  async function checkTransactions(sdk, data, report, check, attempt, devnet) {
    var chain;
    await attempt("chain", async function () {
      chain = await sdk.Chain.load(devnet, data.configuration);
      check("chain nethash", data.nethash, chain.nethash);
      check("chain pinned", data.nethash, chain.profile.chain.nethash);
      check("chain decimals", 8, chain.token.decimals);
    });
    if (chain === undefined) {
      return;
    }
    for (var t = 0; t < data.cases.length; t++) {
      await checkTransaction(data.cases[t]);
    }

    async function checkTransaction(txCase) {
      await attempt("transaction " + txCase.name, async function () {
        var name = "transaction " + txCase.name;
        var account = await signer(sdk, txCase.signer, chain);
        var second = await signer(sdk, txCase.secondSigner, chain);
        var facts = { sender: account, nonce: BigInt(txCase.facts.nonce), height: txCase.facts.height };
        if (txCase.facts.secondKey !== null) {
          facts.secondKey = txCase.facts.secondKey;
        }
        var draft = await sdk.Draft.build(chain, request(txCase.request), facts);
        var summary = draft.summary;
        check(name + " kind", txCase.summary.kind, summary.kind);
        check(name + " operation", JSON.stringify(txCase.summary.operation), operationText(summary.operation));
        check(name + " from", txCase.summary.from, summary.from);
        check(name + " nonce", txCase.summary.nonce, summary.nonce.toString());
        check(name + " fee", txCase.summary.fee, summary.fee.amount.toString());
        check(name + " fee source", txCase.summary.feeSource, summary.fee.source);
        check(name + " fee floor", txCase.summary.feeFloor, summary.fee.floor === undefined ? null : summary.fee.floor.toString());
        check(name + " amount", txCase.summary.amount, summary.amount.toString());
        check(name + " total", String(BigInt(txCase.summary.amount) + BigInt(txCase.summary.fee)), summary.total.toString());
        check(name + " size", txCase.summary.size, summary.size);
        check(name + " second signature", txCase.summary.secondSignature, summary.secondSignature);
        check(name + " unsigned bytes", txCase.unsigned, bytesToHex(draft.unsignedBytes));

        // Built here, serialized, and read back as another context would.
        var again = await sdk.Draft.deserialize(draft.serialize(), chain.profile);
        check(name + " draft round trip", txCase.unsigned, bytesToHex(again.unsignedBytes));
        check(name + " draft round trip summary", JSON.stringify(summary.lines), JSON.stringify(again.summary.lines));
        check(name + " draft round trip fee source", summary.fee.source, again.summary.fee.source);

        // The native signed transaction verifies here and has the native id.
        var native = await sdk.SignedTransaction.fromJson(chain, txCase.json, txCase.facts.height);
        check(name + " native id", txCase.id, native.id);
        if (check(name + " native verifies", true, native.verified)) {
          report.verifiedTransactions += 1;
        }

        var options = second === undefined ? {} : { secondKey: second };
        var fresh = await again.sign(account, options);
        check(name + " fresh verifies", true, fresh.verified);
        check(name + " fresh carries the unsigned bytes", txCase.unsigned, bytesToHex(fresh.bytes).slice(0, txCase.unsigned.length));
        var back = await sdk.SignedTransaction.deserialize(fresh.serialize(), chain.profile);
        check(name + " fresh round trip", fresh.id, back.id);
        if (second !== undefined) {
          check(name + " fresh second signature", true, await fresh.verifySecondSignature(second.publicKey));
        }
        report.freshTransactions += 1;

        if (report.hasFixedAux) {
          var signed = await sdk.testing.signDraftWithAux(draft, account, hexToBytes(txCase.aux), second);
          check(name + " id", txCase.id, signed.id);
          check(name + " bytes", txCase.bytes, bytesToHex(signed.bytes));
          check(name + " json", JSON.stringify(txCase.json), JSON.stringify(signed.json));
          check(name + " draft sha256", txCase.draftSha256, await sdk.testing.sha256(draft.serialize()));
          if (check(name + " signed sha256", txCase.signedSha256, await sdk.testing.sha256(signed.serialize()))) {
            report.fixedAuxTransactions += 1;
          }
        }
        await account.release();
        if (second !== undefined) {
          await second.release();
        }
      });
    }
  }

  globalThis.IceRootVectorChecks = { run: run };
})();
