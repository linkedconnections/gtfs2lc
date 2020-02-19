const KeyvFile = require('keyv-file');

module.exports = function (config, type) {
  var store;
  if (type === 'MemStore') {
    store = new Map();
  } else {
    store = new KeyvFile({ filename: config });
  }
  return store;
};
