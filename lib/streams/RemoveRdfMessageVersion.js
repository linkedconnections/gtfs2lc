const { Transform } = require("node:stream");

class RemoveRdfMessageVersion extends Transform {
  constructor() {
    super();
    this.pending = "";
    this.checkedHeader = false;
  }

  _transform(chunk, _encoding, callback) {
    if (this.checkedHeader) {
      callback(null, chunk);
      return;
    }

    this.pending += chunk.toString();
    const lineEnd = this.pending.indexOf("\n");
    if (lineEnd < 0) {
      callback();
      return;
    }

    const firstLine = this.pending.slice(0, lineEnd).trim();
    const remainder = this.pending.slice(lineEnd + 1);
    this.pending = "";
    this.checkedHeader = true;
    if (/^(?:@version\s+"[^"]+"\s*\.|VERSION\s+"[^"]+")$/u.test(firstLine)) {
      callback(null, remainder);
    } else {
      callback(null, `${firstLine}\n${remainder}`);
    }
  }

  _flush(callback) {
    callback(null, this.pending);
  }
}

module.exports = RemoveRdfMessageVersion;
