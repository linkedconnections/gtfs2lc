const Keyv = require('keyv')
const KeyvFile = require('keyv-file')

class KeyvStore {
    constructor(name) {
        this.name = name;
        this._store = new Keyv({
            store: new KeyvFile({
                filename: this.name
            })
        });
    }

    async get(key) {
        try {
            return await this._store.get(key);
        } catch (err) {
            throw err;
        }
    }

    async put(key, value) {
        try {
            return await this._store.set(key, value);
        } catch (err) {
            throw err;
        }
    }
}

module.exports = KeyvStore;