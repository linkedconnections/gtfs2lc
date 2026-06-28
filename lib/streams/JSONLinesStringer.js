// @ts-check
const { Transform } = require("node:stream");

class JSONLinesStringer extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }

  _transform(value, _encoding, callback) {
    try {
      callback(null, `${JSON.stringify(value)}\n`);
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = JSONLinesStringer;
