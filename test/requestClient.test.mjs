import requestClientModule from "../build/network/requestClient.js";

const { default: RequestClient } = requestClientModule;

describe("RequestClient", () => {
  function createAdapter(logCalls) {
    return {
      log: {
        debug: (message) => {
          logCalls.debug.push(message);
        },
        info: (message) => {
          logCalls.info.push(message);
        },
        warn: (message) => {
          logCalls.warn.push(message);
        },
        error: (message) => {
          logCalls.error.push(message);
        },
      },
    };
  }

  it("serializes plain objects as JSON for fetch requests", async () => {
    const logCalls = {
      debug: [],
      info: [],
      warn: [],
      error: [],
    };
    const requestCalls = [];
    const fetchImpl = async (url, init) => {
      requestCalls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const client = new RequestClient(createAdapter(logCalls), fetchImpl);
    const response = await client.post("https://example.invalid/test", {
      hello: "world",
    });

    response.status.should.equal(200);
    response.data.should.deep.equal({ ok: true });
    requestCalls.should.have.length(1);

    const [{ url, init }] = requestCalls;
    url.should.equal("https://example.invalid/test");
    init.method.should.equal("POST");
    new Headers(init.headers)
      .get("Content-Type")
      .should.equal("application/json");
    init.body.should.equal(JSON.stringify({ hello: "world" }));
    logCalls.debug.should.deep.equal([]);
  });

  it("logs HTTP failures with status code and response payload", async () => {
    const logCalls = {
      debug: [],
      info: [],
      warn: [],
      error: [],
    };
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: "bad request" }), {
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          "Content-Type": "application/json",
        },
      });

    const client = new RequestClient(createAdapter(logCalls), fetchImpl);

    await client
      .get("https://example.invalid/fail", {
        label: "Cloud info request",
      })
      .should.be.rejectedWith("Request failed with status code 500");

    logCalls.debug.should.have.length(1);
    logCalls.debug[0].should.contain("Cloud info request failed");
    logCalls.debug[0].should.contain("status=500");
    logCalls.debug[0].should.contain('"error":"bad request"');
  });

  it("logs timeout errors with ETIMEDOUT", async () => {
    const logCalls = {
      debug: [],
      info: [],
      warn: [],
      error: [],
    };
    const fetchImpl = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => {
            reject(init.signal.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      });

    const client = new RequestClient(createAdapter(logCalls), fetchImpl);

    await client
      .get("https://example.invalid/timeout", {
        label: "Cloud timeout request",
        timeoutMs: 10,
      })
      .should.be.rejectedWith("timeout of 10ms exceeded");

    logCalls.debug.should.have.length(1);
    logCalls.debug[0].should.contain("Cloud timeout request failed");
    logCalls.debug[0].should.contain("(ETIMEDOUT)");
  });

  it("rejects invalid JSON responses that advertise JSON", async () => {
    const logCalls = {
      debug: [],
      info: [],
      warn: [],
      error: [],
    };
    const fetchImpl = async () =>
      new Response("{invalid", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });

    const client = new RequestClient(createAdapter(logCalls), fetchImpl);

    await client
      .get("https://example.invalid/invalid-json", {
        label: "Cloud invalid JSON request",
      })
      .should.be.rejectedWith("Invalid JSON response received");

    logCalls.debug.should.have.length(1);
    logCalls.debug[0].should.contain("(ERR_INVALID_JSON)");
    logCalls.debug[0].should.contain("status=200");
  });
});
