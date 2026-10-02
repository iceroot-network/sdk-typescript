// The assertions of `node:assert/strict` that the test suites use, for contexts without Node's
// module (a Tauri webview): equal, notEqual, deepEqual, ok, match, doesNotMatch, fail, throws and
// rejects, with the same meaning.

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

function show(value) {
  try {
    return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? `${item}n` : item instanceof Uint8Array ? `Uint8Array(${Array.from(item)})` : item));
  } catch {
    return String(value);
  }
}

function failWith(message, fallback) {
  if (message instanceof Error) {
    throw message;
  }
  throw new AssertionError(message ?? fallback);
}

/** Node's deepStrictEqual: same prototypes, own enumerable properties, SameValue on primitives. */
function deepEqualValues(actual, expected, seen = new Map()) {
  if (Object.is(actual, expected)) {
    return true;
  }
  if (typeof actual !== "object" || typeof expected !== "object" || actual === null || expected === null) {
    return false;
  }
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) {
    return false;
  }
  if (seen.get(actual) === expected) {
    return true;
  }
  seen.set(actual, expected);
  if (actual instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  if (ArrayBuffer.isView(actual)) {
    if (actual.length !== expected.length) {
      return false;
    }
    for (let i = 0; i < actual.length; i++) {
      if (!Object.is(actual[i], expected[i])) {
        return false;
      }
    }
    return true;
  }
  if (actual instanceof Map) {
    if (actual.size !== expected.size) {
      return false;
    }
    for (const [key, value] of actual) {
      if (!expected.has(key) || !deepEqualValues(value, expected.get(key), seen)) {
        return false;
      }
    }
    return true;
  }
  if (actual instanceof Set) {
    if (actual.size !== expected.size) {
      return false;
    }
    for (const value of actual) {
      if (!expected.has(value)) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return false;
  }
  const keys = Object.keys(actual);
  if (keys.length !== Object.keys(expected).length) {
    return false;
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(expected, key) || !deepEqualValues(actual[key], expected[key], seen)) {
      return false;
    }
  }
  return true;
}

/** Whether `error` is what `expected` describes, as Node's throws and rejects judge it. */
function judge(error, expected, message) {
  if (expected === undefined) {
    return;
  }
  if (expected instanceof RegExp) {
    if (!expected.test(String(error?.message ?? error)) && !expected.test(String(error))) {
      failWith(message, `the error ${show(String(error))} does not match ${expected}`);
    }
    return;
  }
  if (typeof expected === "function") {
    if (expected.prototype !== undefined && error instanceof expected) {
      return;
    }
    if (Error.isPrototypeOf(expected) || expected === Error) {
      failWith(message, `the error ${error?.name}: ${error?.message} is not a ${expected.name}`);
    }
    if (expected.call({}, error) !== true) {
      failWith(message, `the error ${error?.name}: ${error?.message} failed its validation`);
    }
    return;
  }
  if (typeof expected === "object" && expected !== null) {
    for (const [key, value] of Object.entries(expected)) {
      const own = error?.[key];
      const same = value instanceof RegExp && typeof own === "string" ? value.test(own) : deepEqualValues(own, value);
      if (!same) {
        failWith(message, `the error's ${key} is ${show(own)}, not ${show(value)}`);
      }
    }
    return;
  }
  // A message given where the expectation goes.
  if (typeof expected === "string" && message === undefined) {
    return;
  }
  failWith(message, "an invalid expectation");
}

const assert = {
  equal(actual, expected, message) {
    if (!Object.is(actual, expected)) {
      failWith(message, `expected ${show(expected)}, got ${show(actual)}`);
    }
  },
  strictEqual(actual, expected, message) {
    assert.equal(actual, expected, message);
  },
  notEqual(actual, expected, message) {
    if (Object.is(actual, expected)) {
      failWith(message, `expected something other than ${show(expected)}`);
    }
  },
  deepEqual(actual, expected, message) {
    if (!deepEqualValues(actual, expected)) {
      failWith(message, `expected ${show(expected)}, got ${show(actual)}`);
    }
  },
  deepStrictEqual(actual, expected, message) {
    assert.deepEqual(actual, expected, message);
  },
  ok(value, message) {
    if (!value) {
      failWith(message, `expected a truthy value, got ${show(value)}`);
    }
  },
  match(text, expression, message) {
    if (typeof text !== "string" || !expression.test(text)) {
      failWith(message, `${show(text)} does not match ${expression}`);
    }
  },
  doesNotMatch(text, expression, message) {
    if (typeof text !== "string" || expression.test(text)) {
      failWith(message, `${show(text)} matches ${expression}`);
    }
  },
  fail(message) {
    failWith(message, "failed");
  },
  throws(fn, expected, message) {
    try {
      fn();
    } catch (error) {
      judge(error, expected, typeof expected === "string" ? expected : message);
      return;
    }
    failWith(typeof expected === "string" ? expected : message, "expected an error, nothing was thrown");
  },
  async rejects(promiseOrFn, expected, message) {
    try {
      await (typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn);
    } catch (error) {
      judge(error, expected, typeof expected === "string" ? expected : message);
      return;
    }
    failWith(typeof expected === "string" ? expected : message, "expected a rejection, nothing was rejected");
  },
};

export default assert;
