const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGas(files, globals) {
  const context = vm.createContext(Object.assign({ console }, globals || {}));
  files.forEach((file) => {
    const fullPath = path.resolve(__dirname, '..', file);
    vm.runInContext(fs.readFileSync(fullPath, 'utf8'), context, { filename: fullPath });
  });
  return context;
}

module.exports = { loadGas };
