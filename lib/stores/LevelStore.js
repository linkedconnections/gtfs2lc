var level = require('level');

class LevelStore {
  constructor(name) {
    this.name = name;
    this._store = level(name);
  }

  async get(key) {
    try {
      return JSON.parse(await this._store.get(key));
    } catch (e) {
      throw e;
    }
  }

  put(key, value) {
    return this._store.put(key, value, { valueEncoding: 'json' });
  }
}

module.exports = LevelStore;