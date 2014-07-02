/**
 * Expose a writeable stream and execute it as a set of bulk requests.
 */
'use strict';

var Writable = require('stream').Writable;

module.exports = WritableBulk;

/**
 * @param bulkExec closure pass the bulk cmds as an array and a callback
 * @param defaults: { op: 'index or create, index by default'
                      id: 'name of the property that is the id, by default _id',
 *                    _index: 'name of the index or nothing',
 *                    _type:  'name of the type or nothing' }
 *                nothing to emit an error on unknown document command
 */
function WritableBulk(bulkExec, defaults, bulkSize) {
  Writable.call(this, {objectMode:true});
  this.bulkExec = bulkExec;
  this.bulkSize = bulkSize || 128;
  this.defaults = defaults || {};
  this.defaults.id = this.defaults.id || '_id';
  this.defaults.op = this.defaults.op || 'index';

  this.bulk = [];
  this.bulkCount = 0;
  this.expectingPayload = false;
}

WritableBulk.prototype = Object.create(Writable.prototype, {constructor: {value: WritableBulk}});

/**
 * @param chunk a piece of a bulk request as json.
 */
WritableBulk.prototype._write = function(chunk, enc, next) {
  if (this.expectingPayload) {
    this.bulkCount++;
    this.expectingPayload = false;
  } else if (chunk.hasOwnProperty(this.defaults.id)) {
    var defaultCmd = {};
    defaultCmd[this.defaults.op] = {
      _index: this.defaults._index,
      _type: this.defaults._type,
      _id: chunk[this.defaults.id]
    };
    this.bulk.push(defaultCmd);
    this.bulkCount++;
  } else {
    var willExpectPayload = ['index', 'create', 'update'];
    for (var i = 0; i < willExpectPayload.length; i++) {
      if (chunk.hasOwnProperty(willExpectPayload[i])) {
        this.expectingPayload = willExpectPayload[i];
        break;
      }
    }
    if (!this.expectingPayload) {
      if (!chunk.hasOwnProperty('delete')) {
        this.emit('error', new Error('Unexpected chunk, not index create update delete'));
        return next();
      }
      this.bulkCount++;
    }
  }
  this.bulk.push(chunk);
  if (this.bulkSize <= this.bulkCount) {
    return this._flushBulk(next);
  }
  next();
};

WritableBulk.prototype._flushBulk = function(callback) {
  if (!this.bulkCount) {
    return setImmediate(callback);
  }
  var self = this;
  this.bulkExec(this.bulk, function(e) {
    if (e) {
      // TODO: better than this?
      // - Introspect the response for individual errors
      // - Stream out the responses and correlate with the inputs?
      self.emit('error', e);
    }
    self.bulk = [];
    self.bulkCount = 0;
    self.expectingPayload = false;
    callback();
  });
};

WritableBulk.prototype.end = function(data) {
  var self = this;
  if (!data) {
    return this._flushBulk(function() {
      self.emit('end');
    });
  }
  this._write(data, 'json', function() {
    self._flushBulk(function() {
      self.emit('end');
    });
  });
};