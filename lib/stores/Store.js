var MemStore = require('./MemStore'),
    util = require('util'),
    LevelStore = require('./LevelStore');

module.exports = function (config, type) {
  var store;
  if (type === 'MemStore') {
    store = new MemStore(config);
  } else if (type === 'LevelStore') {
    store = new LevelStore(config); 
  }
  return store;
};
