describe('validateInterval', () => {
    const { validateInterval } = require('../utils');

    it('should return the minimum when the value is too small', () => {
        validateInterval(500, 1000, 5000).should.equal(1000);
    });

    it('should return the maximum when the value is too large', () => {
        validateInterval(6000, 1000, 5000).should.equal(5000);
    });

    it('should return the value when it is within the range', () => {
        validateInterval(3000, 1000, 5000).should.equal(3000);
    });
});
