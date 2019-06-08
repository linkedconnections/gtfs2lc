var level = require('level');

var LevelStore = function (name) {
  this.name = name;
  this._store = level(name);
};

LevelStore.prototype.get = function (key, cb) {
  return new Promise((resolve, reject) => {
    this._store.get(key, function (error, object) {
      if (!error) {
        if(cb)
          cb(null, JSON.parse(object));
        resolve(JSON.parse(object));
      } else {
        cb(error);
        reject(error);
      }
    });
  });
};

LevelStore.prototype.put = function (key, value, cb) {
  return new Promise((resolve, reject) => {
    this._store.put(key, value, {valueEncoding: 'json'}, (error) => {
      if (cb)
        cb(error);
      if (error)
        reject(error);
      else
        resolve();
    });
  });
};

module.exports = LevelStore;
