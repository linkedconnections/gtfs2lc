
class MemStore {
  constructor(name) {
    this.name = name;
    this._store = {};
  }

  get(key) {
    return new Promise((resolve, reject) => {
      if (this._store[key]) {
        resolve(this._store[key]);
      } else {
        reject(key + ' not found in store');
      }
    });
  }

  put(key, value) {
    if (this._store[key]) {
      //don't add it again, but give a warning
      console.error('WARNING: ' + key + ' already exists. Throwing away this value: ' + value);
    } else {
      this._store[key] = value;
    }
  }
}

module.exports = MemStore;