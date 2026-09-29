// The keystore: every record of the keystore vectors (sdk-rust's vectors/sdk/S07-keystore.jsonl,
// whose oracle is an independent JavaScript implementation of the format) through the published
// functions, and through the test build where a record fixes the salt and nonce or lowers the
// parameter floor; round trips of recovery phrases; the wiping of every secret passed as bytes; and
// the error codes. `env.scure` is @scure/bip39 with its English word list.

const VECTORS = "rs/vectors/sdk/S07-keystore.jsonl";
// The lowest parameters the format accepts, so that the round trips run quickly.
const LOW = { memoryKib: 19_456, iterations: 2, parallelism: 1 };

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (text) => Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const text = (bytes) => new TextDecoder().decode(bytes);
const wiped = (bytes) => bytes.every((byte) => byte === 0);

export default function suite(test, env) {
  const { sdk, keystore, testSdk, assert } = env;
  const { entropyToMnemonic, mnemonicToEntropy, wordlist } = env.scure;
  const { testing } = testSdk;
  const PHRASE_24 = entropyToMnemonic(new Uint8Array(32).fill(7), wordlist);

  async function refusal(fn) {
    try {
      await fn();
    } catch (error) {
      return error;
    }
    assert.fail("expected a refusal");
  }

  async function records() {
    const lines = (await env.read(VECTORS)).trim().split("\n").map((line) => JSON.parse(line));
    const [meta, ...rest] = lines;
    assert.equal(meta.class, "S07-keystore");
    assert.equal(rest.length, meta.records);
    return { meta, records: rest };
  }

  /** The outcome of `fn` as the vectors record it: the output, or the error's code and details. */
  async function outcome(fn) {
    try {
      return { output: await fn() };
    } catch (error) {
      // The published build's classes or the test build's: two instances of the SDK.
      assert.ok(error instanceof sdk.IceRootError || error instanceof testSdk.IceRootError, String(error));
      return { error: { class: error.code, details: { ...error.details } } };
    }
  }

  function compare(record, got) {
    const name = `${record.op} ${record.name}`;
    if (record.error !== undefined) {
      assert.deepEqual(got.error, { class: record.error.class, details: record.error.details }, name);
    } else {
      assert.deepEqual(got.output, record.output, name);
    }
  }

  test("the wrapper's constants are the format's", async () => {
    const constants = await testing.keystoreConstants();
    assert.deepEqual(JSON.parse(JSON.stringify(keystore.PRESETS)), constants.presets);
    assert.deepEqual(JSON.parse(JSON.stringify(keystore.BOUNDS)), constants.bounds);
    assert.equal(keystore.MAX_PASSWORD_BYTES, constants.maxPasswordBytes);
    assert.ok(testing.hasKeystoreSeam());
    assert.equal(typeof testSdk.keystore.encrypt, "function");
  });

  test("every keystore vector passes", async () => {
    const { records: all } = await records();
    const tally = {};
    for (const record of all) {
      const input = record.input;
      tally[record.op] = (tally[record.op] ?? 0) + 1;
      switch (record.op) {
        case "keystore.encrypt": {
          // Fixed salt and nonce: the test build's seam, as the Rust runner does it.
          compare(
            record,
            await outcome(async () => {
              const bytes = await testing.keystoreEncryptWithSaltAndNonce(
                input.kind,
                fromHex(input.secret),
                input.password,
                input.params,
                fromHex(input.salt),
                fromHex(input.nonce),
                input.bounds,
              );
              // What was written reads back through the published functions.
              assert.deepEqual({ ...(await keystore.inspect(bytes)) }.memoryKib, input.params.memoryKib);
              assert.equal(hex(await keystore.dearmor(await keystore.armor(bytes))), hex(bytes));
              return { keystore: hex(bytes), text: await keystore.armor(bytes) };
            }),
          );
          break;
        }
        case "keystore.decrypt": {
          const data = input.keystore === undefined ? input.text : fromHex(input.keystore);
          compare(
            record,
            await outcome(async () => {
              const bytes = typeof data === "string" ? await keystore.dearmor(data) : data;
              return testing.keystoreDecryptWithBounds(bytes, input.password, input.bounds);
            }),
          );
          if (input.bounds === "standard") {
            tally.published = (tally.published ?? 0) + 1;
            // The published function opens the same keystores and refuses the same ones.
            compare(
              record,
              await outcome(async () => {
                const opened = await keystore.decrypt(data, input.password);
                const secret = hex(mnemonicToEntropy(text(opened.phrase), wordlist));
                return { kind: opened.kind, secret, wordCount: opened.words };
              }),
            );
          }
          break;
        }
        case "keystore.inspect":
          compare(record, await outcome(async () => ({ ...(await keystore.inspect(fromHex(input.keystore))) })));
          break;
        case "keystore.dearmor":
          compare(record, await outcome(async () => ({ keystore: hex(await keystore.dearmor(input.text)) })));
          break;
        case "keystore.checkParams":
          compare(
            record,
            await outcome(async () => {
              if (input.bounds === "standard") {
                await keystore.checkParams(input.params);
              } else {
                await testing.keystoreCheckParamsWithBounds(input.params, input.bounds);
              }
              return { ok: true };
            }),
          );
          break;
        default:
          assert.fail(`no runner for ${record.op}`);
      }
    }
    assert.deepEqual(tally, {
      "keystore.encrypt": 18,
      "keystore.decrypt": 72,
      "keystore.checkParams": 12,
      "keystore.inspect": 12,
      "keystore.dearmor": 22,
      published: 14,
    });
  });

  test("a recovery phrase round-trips, in bytes and in text", async () => {
    for (const words of [18, 21, 24]) {
      const phrase = entropyToMnemonic(new Uint8Array((words / 3) * 4).fill(words), wordlist);
      const stored = await keystore.encrypt(phrase, "correct horse", LOW);
      const header = await keystore.inspect(stored);
      assert.equal(header.version, 1);
      assert.equal(header.kdf, "argon2id");
      assert.equal(header.payloadKind, "bip39-entropy");
      assert.equal(header.payloadLength, (words / 3) * 4);
      assert.equal(header.keystoreLength, stored.length);
      const opened = await keystore.decrypt(await keystore.armor(stored), "correct horse");
      assert.equal(opened.kind, "bip39-entropy");
      assert.equal(opened.words, words);
      assert.equal(text(opened.phrase), phrase);
    }
    // The phrase is read as keys read it: any white space and case, in its canonical form after.
    const messy = `  ${PHRASE_24.toUpperCase().split(" ").join("\n ")} `;
    const opened = await keystore.decrypt(await keystore.encrypt(messy, "pw", LOW), "pw");
    assert.equal(text(opened.phrase), PHRASE_24);
    // Two keystores of the same phrase and password differ: fresh salt and nonce.
    assert.notEqual(hex(await keystore.encrypt(PHRASE_24, "pw", LOW)), hex(await keystore.encrypt(PHRASE_24, "pw", LOW)));
    // The opened phrase gives the same account as the phrase itself.
    const profile = sdk.profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] });
    const expected = await sdk.Keys.fromPhrase(PHRASE_24, profile);
    const again = await sdk.Keys.fromPhrase((await keystore.decrypt(await keystore.encrypt(PHRASE_24, "pw", LOW), "pw")).phrase, profile);
    assert.equal(again.address, expected.address);
    await expected.release();
    await again.release();
  });

  test("every secret given as bytes is overwritten, whatever the outcome", async () => {
    const encoder = new TextEncoder();
    const phrase = encoder.encode(PHRASE_24);
    const password = encoder.encode("correct horse");
    const stored = await keystore.encrypt(phrase, password, LOW);
    assert.ok(wiped(phrase) && wiped(password));

    const good = encoder.encode("correct horse");
    const opened = await keystore.decrypt(stored, good);
    assert.ok(wiped(good));
    assert.equal(text(opened.phrase), PHRASE_24);
    opened.phrase.fill(0);

    const wrong = encoder.encode("wrong horse");
    assert.ok((await refusal(() => keystore.decrypt(stored, wrong))) instanceof keystore.WrongPasswordOrCorrupt);
    assert.ok(wiped(wrong));

    // Refused before the keystore is read: the arrays are wiped all the same.
    const early = encoder.encode("correct horse");
    assert.ok((await refusal(() => keystore.decrypt("not a keystore", early))) instanceof keystore.Malformed);
    assert.ok(wiped(early));
    const phraseAgain = encoder.encode(PHRASE_24);
    const passwordAgain = encoder.encode("pw");
    assert.ok((await refusal(() => keystore.encrypt(phraseAgain, passwordAgain, "server"))) instanceof sdk.InvalidArgument);
    assert.ok(wiped(phraseAgain) && wiped(passwordAgain));

    const old = encoder.encode("correct horse");
    const next = encoder.encode("battery staple");
    const changed = await keystore.changePassword(stored, old, next, LOW);
    assert.ok(wiped(old) && wiped(next));
    assert.equal(text((await keystore.decrypt(changed, "battery staple")).phrase), PHRASE_24);
    const same = encoder.encode("battery staple");
    const moved = await keystore.reencrypt(changed, same, { ...LOW, iterations: 3 });
    assert.ok(wiped(same));
    assert.equal((await keystore.inspect(moved)).iterations, 3);
  });

  test("presets, parameters and memory limits", async () => {
    // One run of the web preset, the one browsers and extensions use.
    const stored = await keystore.encrypt(PHRASE_24, "correct horse", "web");
    const header = await keystore.inspect(stored);
    assert.deepEqual(
      { memoryKib: header.memoryKib, iterations: header.iterations, parallelism: header.parallelism },
      { ...keystore.PRESETS.web },
    );
    assert.equal(text((await keystore.decrypt(stored, "correct horse")).phrase), PHRASE_24);
    // A platform that cannot spare the memory refuses before any work.
    const limited = await refusal(() => keystore.decrypt(stored, "correct horse", { maxMemoryKib: 32_768 }));
    assert.ok(limited instanceof keystore.ParamsOutOfRange);
    assert.deepEqual(limited.details, { param: "memory", value: 65_536, minimum: 19_456, maximum: 32_768 });

    assert.equal(await keystore.isWeakerThan(header, "desktop"), true);
    assert.equal(await keystore.isWeakerThan(keystore.PRESETS.desktop, "web"), false);
    assert.equal(await keystore.isWeakerThan(LOW, LOW), false);
    await keystore.checkParams("mobile");
    assert.ok((await refusal(() => keystore.checkParams("desktop", { maxMemoryKib: 65_536 }))) instanceof keystore.ParamsOutOfRange);
    const weak = await refusal(() => keystore.encrypt(PHRASE_24, "pw", { memoryKib: 8, iterations: 1, parallelism: 1 }));
    assert.ok(weak instanceof keystore.ParamsOutOfRange);
    assert.equal(weak.details.param, "memory");
  });

  test("a password change and a re-encryption keep to a lowered memory ceiling", async () => {
    const encoder = new TextEncoder();
    const ceiling = { maxMemoryKib: 19_456 };
    const over = { param: "memory", value: 20_480, minimum: 19_456, maximum: 19_456 };
    // A keystore that asks for more memory than the platform can spare: refused before any work,
    // and the passwords given as bytes are wiped all the same.
    const larger = await keystore.encrypt(PHRASE_24, "correct horse", { ...LOW, memoryKib: 20_480 });
    const old = encoder.encode("correct horse");
    const next = encoder.encode("battery staple");
    const changed = await refusal(() => keystore.changePassword(larger, old, next, LOW, ceiling));
    assert.ok(changed instanceof keystore.ParamsOutOfRange, String(changed));
    assert.deepEqual(changed.details, over);
    assert.ok(wiped(old) && wiped(next));
    const same = encoder.encode("correct horse");
    const moved = await refusal(() => keystore.reencrypt(larger, same, LOW, ceiling));
    assert.ok(moved instanceof keystore.ParamsOutOfRange, String(moved));
    assert.deepEqual(moved.details, over);
    assert.ok(wiped(same));

    // New parameters that ask for more are refused too, before the keystore is opened.
    const stored = await keystore.encrypt(PHRASE_24, "correct horse", LOW);
    const higher = { ...LOW, memoryKib: 20_480 };
    assert.deepEqual((await refusal(() => keystore.changePassword(stored, "wrong", "battery staple", higher, ceiling))).details, over);
    assert.deepEqual((await refusal(() => keystore.reencrypt(stored, "wrong", higher, ceiling))).details, over);
    assert.ok((await refusal(() => keystore.reencrypt(stored, "correct horse", LOW, { maxMemoryKib: 1.5 }))) instanceof sdk.InvalidArgument);

    // Within the ceiling, both work.
    const kept = await keystore.changePassword(stored, "correct horse", "battery staple", LOW, ceiling);
    assert.equal(text((await keystore.decrypt(kept, "battery staple")).phrase), PHRASE_24);
    const again = await keystore.reencrypt(kept, "battery staple", { ...LOW, iterations: 3 }, ceiling);
    assert.equal((await keystore.inspect(again)).iterations, 3);
  });

  test("refusals carry the keystore's codes and details", async () => {
    const twelve = entropyToMnemonic(new Uint8Array(16).fill(3), wordlist);
    assert.ok((await refusal(() => keystore.encrypt(twelve, "pw", LOW))) instanceof sdk.PhraseTooShort);
    assert.ok((await refusal(() => keystore.encrypt("not a phrase", "pw", LOW))) instanceof sdk.InvalidPhrase);
    const empty = await refusal(() => keystore.encrypt(PHRASE_24, "", LOW));
    assert.ok(empty instanceof keystore.InvalidPassword);
    assert.deepEqual(empty.details, { reason: "empty" });
    const long = await refusal(() => keystore.encrypt(PHRASE_24, "x".repeat(1025), LOW));
    assert.deepEqual(long.details, { reason: "too-long", bytes: 1025, maximum: 1024 });
    assert.ok((await refusal(() => keystore.encrypt(PHRASE_24, new Uint8Array([0xff]), LOW))) instanceof sdk.InvalidArgument);

    const stored = await keystore.encrypt(PHRASE_24, "pw", LOW);
    const tampered = new Uint8Array(stored);
    tampered[tampered.length - 1] ^= 1;
    const corrupt = await refusal(() => keystore.decrypt(tampered, "pw"));
    assert.ok(corrupt instanceof keystore.WrongPasswordOrCorrupt && corrupt instanceof sdk.IceRootError);
    assert.equal(corrupt.code, "WrongPasswordOrCorrupt");
    const malformed = await refusal(() => keystore.inspect(new Uint8Array([1, 2, 3])));
    assert.ok(malformed instanceof keystore.Malformed);
    assert.equal(malformed.reason, "magic");
    const version = new Uint8Array(stored);
    version[4] = 9;
    assert.ok((await refusal(() => keystore.inspect(version))) instanceof keystore.UnsupportedVersion);
    assert.equal((await refusal(() => keystore.dearmor("irks:!!"))).reason, "armor-encoding");
  });

  test("an account opens straight from a keystore, the phrase never reaching JavaScript", async () => {
    const profile = sdk.profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] });
    const stored = await keystore.encrypt(PHRASE_24, "correct horse", LOW);
    const direct = await sdk.Keys.fromPhrase(PHRASE_24, profile, { index: 3, passphrase: "x" });
    const opened = await sdk.Keys.fromKeystore(stored, "correct horse", profile, { index: 3, passphrase: "x" });
    assert.equal(opened.address, direct.address);
    assert.equal(opened.path, "m/44'/1'/0'/0'/3'");
    assert.equal(opened.legacy, false);
    // The text form, and a password given as bytes, which is wiped.
    const password = new TextEncoder().encode("correct horse");
    const fromText = await sdk.Keys.fromKeystore(await keystore.armor(stored), password, profile, { index: 3, passphrase: "x" });
    assert.equal(fromText.address, direct.address);
    assert.ok(wiped(password), "the password bytes are wiped");
    const first = await sdk.Keys.fromKeystore(stored, "correct horse", profile);
    assert.equal(first.address, (await sdk.Keys.fromPhrase(PHRASE_24, profile)).address);

    const wrong = new TextEncoder().encode("wrong horse");
    assert.ok((await refusal(() => sdk.Keys.fromKeystore(stored, wrong, profile))) instanceof keystore.WrongPasswordOrCorrupt);
    assert.ok(wiped(wrong), "a refused password's bytes are wiped");
    // A platform that cannot spare the memory a keystore asks for refuses it before any work (the
    // ceiling never drops below the format's floor, so this keystore asks for a little more).
    const larger = await keystore.encrypt(PHRASE_24, "correct horse", { ...LOW, memoryKib: 20_480 });
    const limited = await refusal(() => sdk.Keys.fromKeystore(larger, "correct horse", profile, { maxMemoryKib: 19_456 }));
    assert.ok(limited instanceof keystore.ParamsOutOfRange);
    assert.deepEqual(limited.details, { param: "memory", value: 20_480, minimum: 19_456, maximum: 19_456 });
    assert.ok((await refusal(() => sdk.Keys.fromKeystore(stored, "correct horse", profile, { account: 2 ** 31 }))) instanceof sdk.InvalidArgument);
    assert.ok((await refusal(() => sdk.Keys.fromKeystore(new Uint8Array([1, 2, 3]), "pw", profile))) instanceof keystore.Malformed);
    assert.ok((await refusal(() => sdk.Keys.fromKeystore(42, "pw", profile))) instanceof sdk.InvalidArgument);
    for (const account of [direct, opened, fromText, first]) {
      await account.release();
    }
  });
}
