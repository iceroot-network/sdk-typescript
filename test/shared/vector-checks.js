// Checks the SDK against the native Rust vectors in any JavaScript context.
//
// A classic script with no imports, so it loads the same way in Node, a page, a Manifest V3 sandbox
// page, a service worker and a Tauri webview. It defines one global, IceRootVectorChecks, whose
// run(sdk, vectors, context) returns a report instead of throwing, so each context can send the
// report back to the test.
//
// With a test build (sdk.testing present), signatures are also compared byte for byte, because the
// test build can sign with the vectors' fixed auxiliary bytes. With the published build, the
// vectors' signatures must verify, tampered ones must not, and fresh signatures must verify.

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

    report.ok = report.failures.length === 0 && report.checks > 0;
    return report;
  }

  globalThis.IceRootVectorChecks = { run: run };
})();
