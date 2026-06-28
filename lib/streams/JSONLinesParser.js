// @ts-check
const { Transform } = require("node:stream");

class JSONLinesParser extends Transform {
  constructor() {
    super({ readableObjectMode: true });
    this.buffer = "";
  }

  _transform(chunk, _encoding, callback) {
    try {
      this.buffer += chunk.toString();
      const lines = this.buffer.split(/\r?\n/u);
      this.buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) this.push({ value: JSON.parse(line) });
      }
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    try {
      if (this.buffer.trim()) this.push({ value: JSON.parse(this.buffer) });
      callback();
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = JSONLinesParser;
