const MemStore = require('./MemStore'),
  KeyvStore = require('./KeyvStore');

module.exports = (type, name, store) => {
  if (type === 'MemStore') {
    return new MemStore(name, store);
  } else if (type === 'KeyvStore') {
    return new KeyvStore(name);
  }
};
