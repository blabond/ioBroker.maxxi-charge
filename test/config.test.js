describe("normalizeConfig", () => {
  const { normalizeConfig } = require("../build/config");

  it("uses a fixed 5 second interval in cloud mode", () => {
    const config = normalizeConfig({
      apimode: "cloud",
      ccuinterval: "5",
    });

    config.ccuIntervalMs.should.equal(5000);
  });

  [10, 30, 90].forEach((legacyValue) => {
    it(`ignores legacy cloud interval ${legacyValue}s`, () => {
      const config = normalizeConfig({
        apimode: "cloud",
        ccuinterval: String(legacyValue),
      });

      config.ccuIntervalMs.should.equal(5000);
    });
  });

  it("keeps local mode interval normalization unchanged", () => {
    const config = normalizeConfig({
      apimode: "local",
      ccuinterval: "30",
    });

    config.ccuIntervalMs.should.equal(30000);
  });
});
