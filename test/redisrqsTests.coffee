chai = require "chai"
chai.should()

assert = chai.assert
RedisRQS = require "../redisrqs"

queue = new RedisRQS
  redis:
    port: 6379,
    host: "localhost",
    family: 4,
    db: 15

  redisrqs:
    sweepInterval: 10000

describe "RedisRQS Tests:", ->
  after (done) ->
    queue.drainQueues().then -> done()
    return

  before  ->
    queue.on "redisrqs:enqueue", ->
      queue.getPendingQueueSize()
        .then (count) ->
          count.should.equal 1

  it "Should be a class of type RedisRQS", (done) ->
    assert.instanceOf queue, RedisRQS
    done()

  it "Should contain identifiable queue names", (done) ->
    assert.equal "redisrqs:pending", queue.getQueueNames().pending
    done()

  it "Working queue should be empty", ->
    queue.getWorkingQueueSize().then (result) -> result.should.equal(0)

  it "Pending queue should be empty", ->
    queue.getPendingQueueSize().then (result) -> result.should.equal(0)

  it "Values queue should be empty", ->
    queue.getValuesQueueSize().then (result) -> result.should.equal(0)

  it "Pending queue should contain a valid message when queued", (done) ->
    uuid = ""
    obj =
      topic: "Test",
      data: "This is a test message"

    message = JSON.stringify obj

    queue.enqueue "foo", message
      .then (result) ->
        message = JSON.parse JSON.parse(result[1]).data
        message.topic.should.equal obj.topic
        message.data.should.equal obj.data
      .then ->
        queue.drainQueues().then -> done()
      .catch (err) ->
        done(err)

    queue.once "redisrqs:enqueue", (result) ->
      message = JSON.parse result.message
      message.topic.should.equal obj.topic
      message.data.should.equal obj.data

    queue.once "foo", (result) ->
      uuid = result.uuid
      message = JSON.parse result.message
      message.topic.should.equal obj.topic
      message.data.should.equal obj.data

  it "Requeuing the message should result in a valid pending message", (done) ->
    uuid = ""
    obj =
      topic: "Test2",
      data: "This is a test message2"

    message = JSON.stringify obj

    queue.enqueue "foo2", message
      .then (result) ->
        message = JSON.parse JSON.parse(result[1]).data
        message.topic.should.equal obj.topic
        message.data.should.equal obj.data
      .then ->
        queue.dequeue().then (result) ->
          message = JSON.parse result.message
          message.topic.should.equal obj.topic
          message.data.should.equal obj.data
      .catch (err) ->
        done(err)

    queue.once "redisrqs:requeue", (result) ->
      uuid.should.equal result
      queue.getPendingQueueSize()
        .then (count) ->
          count.should.equal 1
          queue.drainQueues().then -> done()

    queue.once "redisrqs:dequeue", (result) ->
      message = JSON.parse result.message
      message.data.should.equal obj.data
      queue.requeue result.uuid

    queue.once "foo2", (result) ->
      uuid = result.uuid
      message = JSON.parse result.message
      message.data.should.equal obj.data

  it "Sweep interval should be honored when creating a RedisRQS instance", (done) ->
    interval = 10000
    queue.once "redisrqs:sweep", ->
      queue.getSweepInterval().should.equal interval
      done()
