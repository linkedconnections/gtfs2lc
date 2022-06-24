const { Level } = require('level');

module.exports = function ({ fileName, encoding }, type) {
  let store;
  if (type === 'MemStore') {
    store = new Map();
  } else {
    store = new Level(fileName, { valueEncoding: encoding });
  }
  return store;
};
