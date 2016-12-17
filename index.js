(function () {
  'use strict';

  var EventEmitter, Promise, Redis, RedisRQS, async;

  EventEmitter = require("events").EventEmitter;
  Redis = require('ioredis');
  async = require('async');
  Promise = require('bluebird');

  RedisRQS = function (options) {
    // Validate the options
    if (options.redis === void 0) {
      throw new Error('Redis connection options are missing');
    }

    if (options.redisrqs === void 0) {
      throw new Error('RedisRQS options are missing');
    }

    if (options.redisrqs.sweepInterval === void 0) {
      options.redisrqs.sweepInterval = 60000; // Default to 1 minute
    }

    this._options = options;
    this._ee = new EventEmitter();
    this._moment = require("moment");
    this._uuid = require("uuid");
    this._queueNames = {
      working: "redisrqs:working",
      pending: "redisrqs:pending",
      values: "redisrqs:values"
    };
    this._queue = new Redis(this._options.redis);

    this._queue.defineCommand("enqueue", {
      numberOfKeys: 1,
      lua: "redis.call('LPUSH', '" + this._queueNames.pending + "', KEYS[1])\n" +
      "redis.call('HSET', '" + this._queueNames.values + "', KEYS[1], ARGV[1])\n" +
      "return {KEYS[1], ARGV[1]}"
    });

    this._queue.defineCommand("dequeue", {
      numberOfKeys: 1,
      lua: "local uuid = redis.call('RPOP', '" + this._queueNames.pending + "')\n" +
      "if type(uuid) == 'boolean' then\n" +
      "  return nil\n" +
      "else\n" +
      "    redis.call('ZADD', '" + this._queueNames.working + "', ARGV[1], uuid)\n" +
      "    if redis.call('HEXISTS', '" + this._queueNames.values + "', uuid) == 1 then\n" +
      "      local payload = redis.call('HGET', '" + this._queueNames.values + "', uuid)\n" +
      "      return {uuid, payload}\n" +
      "    else\n" +
      "      return nil\n" +
      "    end\n" +
      "end"
    });

    this._queue.defineCommand("release", {
      numberOfKeys: 1,
      lua: "redis.call('ZREM', '" + this._queueNames.working + "', ARGV[1])\n" +
      "redis.call('HDEL', '" + this._queueNames.values + "', ARGV[1])\n" +
      "return ARGV[1]"
    });

    this._queue.defineCommand("requeue", {
      numberOfKeys: 1,
      lua: "redis.call('ZREM', '" + this._queueNames.working + "', ARGV[1])\n" +
      "redis.call('LPUSH', '" + this._queueNames.pending + "', ARGV[1])\n" +
      "return ARGV[1]"
    });

    this._queue.defineCommand("sweep", {
      numberOfKeys: 2,
      lua: "local uuids = redis.call('ZRANGEBYSCORE', '" + this._queueNames.working + "', 0, ARGV[1] - ARGV[2])\n" +
      "for _, key in ipairs(uuids) do\n" +
      "  redis.call('LPUSH', '" + this._queueNames.pending + "', key)\n" +
      "  redis.call('ZREM', '" + this._queueNames.working + "', key)\n" +
      "end"
    });

    // Set the sweep command to execute every interval
    setInterval(this._sweepFunc.bind(this), options.sweepInterval);

    async.forever(this.dequeue.bind(this), function (err) {
      throw new Error(err);
    });
  };

  /**
   * Generate a new UUID.
   * @private
   */
  RedisRQS.prototype._newUUID = function () {
    var self;
    self = this;
    return self._uuid.v4();
  };

  /**
   * Sweep function.
   * @private
   */
  RedisRQS.prototype._sweepFunc = function () {
    var self;
    self = this;
    return self._queue.sweep("timestamp", "interval", self._moment.utc().valueOf(), self.getSweepInterval())
      .then(function () {
        return self._ee.emit("redisrqs:sweep", new Date());
      });
  };

  /**
   * Get the currently configured sweep interval.
   */
  RedisRQS.prototype.getSweepInterval = function () {
    var self;
    self = this;
    return self._options.redisrqs.sweepInterval;
  };

  /**
   * Get the names of the queues.
   */
  RedisRQS.prototype.getQueueNames = function () {
    var self;
    self = this;
    return self._queueNames;
  };

  /**
   * Queue the message.
   */
  RedisRQS.prototype.enqueue = function (topic, message) {
    var payload, self, uuid;
    if (typeof topic !== "string") {
      throw new Error("enqueue: topic must be a string");
    }
    if (typeof message !== "string") {
      throw new Error("enqueue: message must be a string or a stringified JSON object");
    }
    self = this;
    uuid = self._newUUID();
    payload = JSON.stringify({
      "topic": topic,
      "data": message
    });

    return new Promise(function (resolve, reject) {
      self._queue.enqueue(uuid, payload)
        .then(function (result) {
          if (result !== null && typeof result === "object") {
            uuid = result[0];
            payload = JSON.parse(result[1]);
            var d = {
              "uuid": uuid,
              "message": payload.data
            };
            self._ee.emit("redisrqs:enqueue", d);
          }
          return resolve(result);
        })
        .catch(function (err) {
          return reject("enqueue: Could not queue the message! " + err);
        });
    });
  };

  RedisRQS.prototype.dequeue = function (next) {
    var self;
    self = this;
    return new Promise(function (resolve, reject) {
      self._queue.dequeue("timestamp", self._moment.utc().valueOf())
        .then(function (result) {
          var payload, uuid;
          if (result !== null && typeof result === "object") {
            uuid = result[0];
            payload = JSON.parse(result[1]);
            var d = {
              "uuid": uuid,
              "message": payload.data
            };
            self._ee.emit("redisrqs:dequeue", d);
            self._ee.emit(payload.topic, d);
          }
          return resolve(next());
        })
        .catch(function (err) {
          return reject("dequeue: Unable to get the next message. " + err);
        });
    });
  };

  RedisRQS.prototype.release = function (uuid) {
    var self;
    self = this;
    return new Promise(function (resolve, reject) {
      self._queue.release("uuid", uuid)
        .then(function (result) {
          if (result !== null && typeof result === "string") {
            self._ee.emit("redisrqs:release", result);
            return resolve(result);
          }
        })
        .catch(function (err) {
          return reject('release: Unable to remove the message. ' + err);
        });
    });
  };

  RedisRQS.prototype.requeue = function (uuid) {
    var self;
    self = this;
    return new Promise(function (resolve, reject) {
      self._queue.requeue("uuid", uuid)
        .then(function (result) {
          self._ee.emit("redisrqs:requeue", result);
          return resolve(result);
        })
        .catch(function (err) {
          return reject("requeue: Unable to requeue the message. " + err);
        });
    });
  };

  RedisRQS.prototype.getWorkingQueueSize = function () {
    var self;
    self = this;
    return self._queue.zcount(self._queueNames.working, "-inf", "+inf");
  };

  RedisRQS.prototype.getPendingQueueSize = function () {
    var self;
    self = this;
    return self._queue.llen(self._queueNames.pending);
  };

  RedisRQS.prototype.getValuesQueueSize = function () {
    var self;
    self = this;
    return self._queue.hlen(self._queueNames.values);
  };

  RedisRQS.prototype.drainQueues = function () {
    var self;
    self = this;
    return new Promise(function (resolve, reject) {
      async.parallel([
        function (next) {
          self._queue.del(self._queueNames.pending)
            .then(function () {
              next();
            });
        }, function (next) {
          self._queue.del(self._queueNames.working)
            .then(function () {
              next();
            });
        }, function (next) {
          self._queue.del(self._queueNames.values)
            .then(function () {
              next();
            });
        }
      ], function (err, result) {
        if (err !== null) {
          return reject(err);
        }

        return resolve(result);
      });
    });
  };

  RedisRQS.prototype.on = function (evt, callback) {
    var self;
    if (typeof evt !== "string") {
      throw new Error("event name must be of type string");
    }
    if (typeof callback !== "function") {
      throw new Error("callback must be of type function");
    }
    self = this;
    return self._ee.on(evt, callback);
  };

  RedisRQS.prototype.once = function (evt, callback) {
    var self;
    if (typeof evt !== "string") {
      throw new Error("event name must be of type string");
    }
    if (typeof callback !== "function") {
      throw new Error("callback must be of type function");
    }
    self = this;
    return self._ee.once(evt, callback);
  };

  module.exports = RedisRQS;

}).call(this);
