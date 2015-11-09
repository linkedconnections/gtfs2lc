var MemStore = function (name) {
  this.name = name;
  this._store = {};
};

MemStore.prototype.get = function (key, cb) {
  if (this._store[key]) {
    cb(null, this._store[key]);
  } else {
    cb(key + ' not found in store');
  }
};

MemStore.prototype.put = function (key, value, cb) {
  if (this._store[key]) {
    cb(key + ' already exists');
  } else {
    this._store[key] = value;
    cb();
  }
};

module.exports = MemStore;
