const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

test('loads GAS utility functions in a Node VM', () => {
  const gas = loadGas(['src/Config.js', 'src/Utils.js']);
  assert.equal(gas.padNumber_(7, 3), '007');
});
