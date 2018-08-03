var MemStore = require('./MemStore'),
    LevelStore = require('./LevelStore');

module.exports = (config, type) => {
  if (type === 'MemStore') {
    return new MemStore(config);
  } else if (type === 'LevelStore') {
    return new LevelStore(config); 
  }
};
