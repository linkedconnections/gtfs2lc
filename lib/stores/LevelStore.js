var level = require('level');

var LevelStore = function (name) {
  this.name = name;
  this._store = level(name);
};

LevelStore.prototype.get = function (key, cb) {
  return new Promise((resolve, reject) => {
    this._store.get(key, (error, object) => {
      if (!error) {
        resolve(JSON.parse(object));
      } else {
        reject(error);
      }
    });
  });
};

LevelStore.prototype.put = function (key, value, cb) {
  this._store.put(key, value, { valueEncoding: 'json' }, cb);
};

module.exports = LevelStore;
