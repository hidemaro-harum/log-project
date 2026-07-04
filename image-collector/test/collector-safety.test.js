const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

test('hasPendingCollectWork_ detects saved state and collect triggers', () => {
  const gas = loadGas(['src/Config.js', 'src/Collector.js']);
  const emptyProps = { getProperty: () => null };
  assert.equal(gas.hasPendingCollectWork_(emptyProps, []), false);
  assert.equal(gas.hasPendingCollectWork_({ getProperty: (key) => key === gas.PROP_KEYS.PROGRESS ? '{}' : null }, []), true);
  assert.equal(gas.hasPendingCollectWork_(emptyProps, [{ getHandlerFunction: () => 'resumeCollect' }]), true);
});

test('isDuplicateCollectFolder_ registers each folder id once', () => {
  const gas = loadGas(['src/Config.js', 'src/Collector.js']);
  const seen = {};
  assert.equal(gas.isDuplicateCollectFolder_(seen, 'folder-1'), false);
  assert.equal(gas.isDuplicateCollectFolder_(seen, 'folder-1'), true);
  assert.equal(gas.isDuplicateCollectFolder_(seen, 'folder-2'), false);
});
