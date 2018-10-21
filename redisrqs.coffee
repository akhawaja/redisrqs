class RedisRQS
  EventEmitter = require("events").EventEmitter
  Redis = require "ioredis"
  async = require "async"

  constructor: (options) ->
    # Validate the options
    if not options?
      throw new Error "Options are missing"

    if not options.redis?
      throw new Error "Redis connection options are missing"

    if not options.redisrqs?
      throw new Error "RedisRQS options are missing"

    if not options.redisrqs.sweepInterval?
      # Default to 1-minute
      options.redisrqs.sweepInterval = 60000

    @_options = options;
    @_ee = new EventEmitter();
    @_moment = require("moment");
    @_uuid = require("uuid");
    @_queueNames =
      working: "redisrqs:working"
      pending: "redisrqs:pending"
      values: "redisrqs:values"

    @_queue = new Redis(@_options.redis);

    @_queue.defineCommand "enqueue",
      numberOfKeys: 1
      lua: """
           redis.call("LPUSH", "#{@_queueNames.pending}", KEYS[1])
           redis.call("HSET", "#{@_queueNames.values}", KEYS[1], ARGV[1])
           return {KEYS[1], ARGV[1]}
           """

    @_queue.defineCommand "dequeue",
      numberOfKeys: 1
      lua: """
           local uuid = redis.call("RPOP", "#{@_queueNames.pending}")
           if type(uuid) == "boolean" then
             return nil
           else
             redis.call("ZADD", "#{@_queueNames.working}", ARGV[1], uuid)
               if redis.call("HEXISTS", "#{@_queueNames.values}", uuid) == 1 then
                 local payload = redis.call("HGET", "#{@_queueNames.values}", uuid)
                 return {uuid, payload}
               else
                 return nil
               end
           end
           """

    @_queue.defineCommand "release",
      numberOfKeys: 1
      lua: """
           redis.call("ZREM", "#{@_queueNames.working}", ARGV[1])
           redis.call("HDEL", "#{@_queueNames.values}", ARGV[1])
           return ARGV[1]
           """

    @_queue.defineCommand "requeue",
      numberOfKeys: 1
      lua: """
           redis.call("ZREM", "#{@_queueNames.working}", ARGV[1])
           redis.call("LPUSH", "#{@_queueNames.pending}", ARGV[1])
           return ARGV[1]
           """

    @_queue.defineCommand "sweep",
      numberOfKeys: 2
      lua: """
           local uuids = redis.call("ZRANGEBYSCORE", "#{@_queueNames.working}", 0, ARGV[1] - ARGV[2])
           for _, key in ipairs(uuids) do
             redis.call("LPUSH", "#{@_queueNames.pending}", key)
             redis.call("ZREM", "#{@_queueNames.working}", key)
           end
           """

    # Set the sweep command to execute every interval
    setInterval @_sweepFunc.bind(@), options.sweepInterval

    async.forever @dequeue.bind(@), (err) ->
      throw new Error err

  _newUUID: ->
    @_uuid.v4();

  _sweepFunc: ->
    self = @
    @_queue.sweep "timestamp", "interval", @_moment.utc().valueOf(), @getSweepInterval()
      .then ->
        self._ee.emit "redisrqs:sweep", new Date()

  getSweepInterval: ->
    @_options.redisrqs.sweepInterval

  getQueueNames: ->
    @_queueNames

  enqueue: (topic, message) ->
    if typeof topic isnt "string"
      throw new Error "enqueue: topic must be a string"

    if typeof message isnt "string"
      throw new Error "enqueue: message must be a string or a stringified JSON object"

    uuid = @_newUUID();
    payload = JSON.stringify "topic": topic, "data": message
    self = @

    new Promise (resolve, reject) ->
      self._queue.enqueue uuid, payload
        .then (result) ->
          if result?
            uuid = result[0]
            payload = JSON.parse result[1]
            d =
              "uuid": uuid
              "message": payload.data

            self._ee.emit "redisrqs:enqueue", d
            resolve result

        .catch (err) ->
          reject "enqueue: Could not queue the message! #{err}"

  dequeue: ->
    self = @

    new Promise (resolve, reject) ->
      self._queue.dequeue "timestamp", self._moment.utc().valueOf()
        .then (result) ->
          if result?
            uuid = result[0]
            payload = JSON.parse result[1]
            d =
              "uuid": uuid
              "message": payload.data
            self._ee.emit "redisrqs:dequeue", d
            self._ee.emit payload.topic, d

            resolve d

        .catch (err) ->
          reject "dequeue: Unable to get the next message. #{err}"

  release: (uuid) ->
    self = @

    new Promise (resolve, reject) ->
      self._queue.release "uuid", uuid
        .then (result) ->
          if result?
            self._ee.emit "redisrqs:release", result
            resolve result

        .catch (err) ->
          reject "release: Unable to remove the message. #{err}"

  requeue: (uuid) ->
    self = @

    new Promise (resolve, reject) ->
      self._queue.requeue("uuid", uuid)
        .then (result) ->
          if result?
            self._ee.emit "redisrqs:requeue", result
            resolve result

        .catch (err) ->
          reject "requeue: Unable to requeue the message. #{err}"

  getWorkingQueueSize: ->
    self = @
    new Promise (resolve, reject) ->
        resolve self._queue.zcount self._queueNames.working, "-inf", "+inf"

  getPendingQueueSize: ->
    self = @
    new Promise (resolve, reject) ->
      resolve self._queue.llen self._queueNames.pending

  getValuesQueueSize: ->
    self = @
    new Promise (resolve, reject) ->
      resolve self._queue.hlen self._queueNames.values

  drainQueues: ->
    self = @

    new Promise (resolve, reject) ->
      callbacks = [
        (next) ->
          self._queue.del(self._queueNames.pending).then -> next()

        (next) ->
          self._queue.del(self._queueNames.working).then -> next()

        (next) ->
          self._queue.del(self._queueNames.values).then -> next()
      ]
      async.parallel callbacks, (err, result) ->
        if err?
          reject err

        self._ee.emit "redisrqs:drainQueues", new Date()
        resolve result

  on: (evt, callback) ->
    if typeof evt isnt "string"
      throw new Error "event name must be of type string"

    if typeof callback isnt "function"
      throw new Error "callback must be of type function"

    @_ee.on(evt, callback);

  once: (evt, callback) ->
    if typeof evt isnt "string"
      throw new Error "event name must be of type string"

    if typeof callback isnt "function"
      throw new Error "callback must be of type function"

    @_ee.once(evt, callback);

module.exports = RedisRQS
