(function() {
  var RedisRQS;

  RedisRQS = (function() {
    var EventEmitter, Redis, async;

    class RedisRQS {
      constructor(options) {
        // Validate the options
        if (options == null) {
          throw new Error("Options are missing");
        }
        if (options.redis == null) {
          throw new Error("Redis connection options are missing");
        }
        if (options.redisrqs == null) {
          throw new Error("RedisRQS options are missing");
        }
        if (options.redisrqs.sweepInterval == null) {
          // Default to 1-minute
          options.redisrqs.sweepInterval = 60000;
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
          lua: `redis.call("LPUSH", "${this._queueNames.pending}", KEYS[1])\nredis.call("HSET", "${this._queueNames.values}", KEYS[1], ARGV[1])\nreturn {KEYS[1], ARGV[1]}`
        });
        this._queue.defineCommand("dequeue", {
          numberOfKeys: 1,
          lua: `local uuid = redis.call("RPOP", "${this._queueNames.pending}")\nif type(uuid) == "boolean" then\n  return nil\nelse\n  redis.call("ZADD", "${this._queueNames.working}", ARGV[1], uuid)\n    if redis.call("HEXISTS", "${this._queueNames.values}", uuid) == 1 then\n      local payload = redis.call("HGET", "${this._queueNames.values}", uuid)\n      return {uuid, payload}\n    else\n      return nil\n    end\nend`
        });
        this._queue.defineCommand("release", {
          numberOfKeys: 1,
          lua: `redis.call("ZREM", "${this._queueNames.working}", ARGV[1])\nredis.call("HDEL", "${this._queueNames.values}", ARGV[1])\nreturn ARGV[1]`
        });
        this._queue.defineCommand("requeue", {
          numberOfKeys: 1,
          lua: `redis.call("ZREM", "${this._queueNames.working}", ARGV[1])\nredis.call("LPUSH", "${this._queueNames.pending}", ARGV[1])\nreturn ARGV[1]`
        });
        this._queue.defineCommand("sweep", {
          numberOfKeys: 2,
          lua: `local uuids = redis.call("ZRANGEBYSCORE", "${this._queueNames.working}", 0, ARGV[1] - ARGV[2])\nfor _, key in ipairs(uuids) do\n  redis.call("LPUSH", "${this._queueNames.pending}", key)\n  redis.call("ZREM", "${this._queueNames.working}", key)\nend`
        });
        // Set the sweep command to execute every interval
        setInterval(this._sweepFunc.bind(this), options.sweepInterval);
        async.forever(this.dequeue.bind(this), function(err) {
          throw new Error(err);
        });
      }

      _newUUID() {
        return this._uuid.v4();
      }

      _sweepFunc() {
        var self;
        self = this;
        return this._queue.sweep("timestamp", "interval", this._moment.utc().valueOf(), this.getSweepInterval()).then(function() {
          return self._ee.emit("redisrqs:sweep", new Date());
        });
      }

      getSweepInterval() {
        return this._options.redisrqs.sweepInterval;
      }

      getQueueNames() {
        return this._queueNames;
      }

      enqueue(topic, message) {
        var payload, self, uuid;
        if (typeof topic !== "string") {
          throw new Error("enqueue: topic must be a string");
        }
        if (typeof message !== "string") {
          throw new Error("enqueue: message must be a string or a stringified JSON object");
        }
        uuid = this._newUUID();
        payload = JSON.stringify({
          "topic": topic,
          "data": message
        });
        self = this;
        return new Promise(function(resolve, reject) {
          return self._queue.enqueue(uuid, payload).then(function(result) {
            var d;
            if (result != null) {
              uuid = result[0];
              payload = JSON.parse(result[1]);
              d = {
                "uuid": uuid,
                "message": payload.data
              };
              self._ee.emit("redisrqs:enqueue", d);
              return resolve(result);
            }
          }).catch(function(err) {
            return reject(`enqueue: Could not queue the message! ${err}`);
          });
        });
      }

      dequeue() {
        var self;
        self = this;
        return new Promise(function(resolve, reject) {
          return self._queue.dequeue("timestamp", self._moment.utc().valueOf()).then(function(result) {
            var d, payload, uuid;
            if (result != null) {
              uuid = result[0];
              payload = JSON.parse(result[1]);
              d = {
                "uuid": uuid,
                "message": payload.data
              };
              self._ee.emit("redisrqs:dequeue", d);
              self._ee.emit(payload.topic, d);
              return resolve(d);
            }
          }).catch(function(err) {
            return reject(`dequeue: Unable to get the next message. ${err}`);
          });
        });
      }

      release(uuid) {
        var self;
        self = this;
        return new Promise(function(resolve, reject) {
          return self._queue.release("uuid", uuid).then(function(result) {
            if (result != null) {
              self._ee.emit("redisrqs:release", result);
              return resolve(result);
            }
          }).catch(function(err) {
            return reject(`release: Unable to remove the message. ${err}`);
          });
        });
      }

      requeue(uuid) {
        var self;
        self = this;
        return new Promise(function(resolve, reject) {
          return self._queue.requeue("uuid", uuid).then(function(result) {
            if (result != null) {
              self._ee.emit("redisrqs:requeue", result);
              return resolve(result);
            }
          }).catch(function(err) {
            return reject(`requeue: Unable to requeue the message. ${err}`);
          });
        });
      }

      getWorkingQueueSize() {
        var self;
        self = this;
        return new Promise(function(resolve, reject) {
          return resolve(self._queue.zcount(self._queueNames.working, "-inf", "+inf"));
        });
      }

      getPendingQueueSize() {
        var self;
        self = this;
        return new Promise(function(resolve, reject) {
          return resolve(self._queue.llen(self._queueNames.pending));
        });
      }

      getValuesQueueSize() {
        var self;
        self = this;
        return new Promise(function(resolve, reject) {
          return resolve(self._queue.hlen(self._queueNames.values));
        });
      }

      drainQueues() {
        var self;
        self = this;
        return new Promise(function(resolve, reject) {
          var callbacks;
          callbacks = [
            function(next) {
              return self._queue.del(self._queueNames.pending).then(function() {
                return next();
              });
            },
            function(next) {
              return self._queue.del(self._queueNames.working).then(function() {
                return next();
              });
            },
            function(next) {
              return self._queue.del(self._queueNames.values).then(function() {
                return next();
              });
            }
          ];
          return async.parallel(callbacks, function(err, result) {
            if (err != null) {
              reject(err);
            }
            self._ee.emit("redisrqs:drainQueues", new Date());
            return resolve(result);
          });
        });
      }

      on(evt, callback) {
        if (typeof evt !== "string") {
          throw new Error("event name must be of type string");
        }
        if (typeof callback !== "function") {
          throw new Error("callback must be of type function");
        }
        return this._ee.on(evt, callback);
      }

      once(evt, callback) {
        if (typeof evt !== "string") {
          throw new Error("event name must be of type string");
        }
        if (typeof callback !== "function") {
          throw new Error("callback must be of type function");
        }
        return this._ee.once(evt, callback);
      }

    };

    EventEmitter = require("events").EventEmitter;

    Redis = require("ioredis");

    async = require("async");

    return RedisRQS;

  }).call(this);

  module.exports = RedisRQS;

}).call(this);

//# sourceMappingURL=redisrqs.js.map
