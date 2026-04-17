import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';

// Don't silently swallow unhandled rejections
process.on('unhandledRejection', e => {
    throw e;
});

// enable the should interface with sinon
// and load chai-as-promised and sinon-chai by default
const { should, use } = chai;

should();
use(sinonChai);
use(chaiAsPromised);
