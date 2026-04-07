describe("normalizeConfig", () => {
  const { normalizeConfig } = require("../build/config");

  it("allows 5 second cloud polling intervals", () => {
    const config = normalizeConfig({
      ccuinterval: "5",
    });

    config.ccuIntervalMs.should.equal(5000);
  });
});
