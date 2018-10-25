var MemStore = function (name) {
  this.name = name;
  this._store = {};
};

MemStore.prototype.get = function (key, cb) {
  return new Promise((resolve, reject) => {
    if (this._store[key]) {
      if (cb)
        cb(null, this._store[key]);
      resolve(this._store[key]);
    } else {
      if (cb)
        cb(key + ' not found in store');
      reject(key + ' not found in store');
    }
  });
};

MemStore.prototype.put = function (key, value, cb) {
  return new Promise((resolve, reject) => {
    if (this._store[key]) {
      //don't add it again, but give a warning
      console.error('WARNING: ' + key + ' already exists. Throwing away this value: ' + value);
      if (cb)
        cb();
      resolve();
    } else {
      this._store[key] = value;
      if (cb) 
        cb();
      resolve();
    }
  });
};

module.exports = MemStore;
