(function() {
  var RedisRQS, assert, chai, queue;

  chai = require("chai");

  chai.should();

  assert = chai.assert;

  RedisRQS = require("../redisrqs");

  queue = new RedisRQS({
    redis: {
      port: 6379,
      host: "localhost",
      family: 4,
      db: 15
    },
    redisrqs: {
      sweepInterval: 10000
    }
  });

  describe("RedisRQS Tests:", function() {
    afterEach(function(done) {
      queue.drainQueues().then(function() {
        return done();
      });
    });
    before(function() {
      return queue.on("redisrqs:enqueue", function() {
        return queue.getPendingQueueSize().then(function(count) {
          return assert.isAtLeast(count, 1);
        });
      });
    });
    it("Should be a class of type RedisRQS", function(done) {
      assert.instanceOf(queue, RedisRQS);
      return done();
    });
    it("Should contain identifiable queue names", function(done) {
      assert.equal("redisrqs:pending", queue.getQueueNames().pending);
      return done();
    });
    it("Working queue should be empty", function() {
      return queue.getWorkingQueueSize().then(function(result) {
        return result.should.equal(0);
      });
    });
    it("Pending queue should be empty", function() {
      return queue.getPendingQueueSize().then(function(result) {
        return result.should.equal(0);
      });
    });
    it("Values queue should be empty", function() {
      return queue.getValuesQueueSize().then(function(result) {
        return result.should.equal(0);
      });
    });
    it("Pending queue should contain a valid message when queued", function(done) {
      var message, obj, uuid;
      uuid = "";
      obj = {
        topic: "Test",
        data: "This is a test message"
      };
      message = JSON.stringify(obj);
      queue.enqueue("foo", message).then(function(result) {
        message = JSON.parse(JSON.parse(result[1]).data);
        message.topic.should.equal(obj.topic);
        message.data.should.equal(obj.data);
        return done();
      }).catch(function(err) {
        return done(err);
      });
      queue.once("redisrqs:enqueue", function(result) {
        message = JSON.parse(result.message);
        message.topic.should.equal(obj.topic);
        return message.data.should.equal(obj.data);
      });
      return queue.once("foo", function(result) {
        uuid = result.uuid;
        message = JSON.parse(result.message);
        message.topic.should.equal(obj.topic);
        return message.data.should.equal(obj.data);
      });
    });
    it("Two messages must exist with the same topic name", function(done) {
      var message, obj, topic, uuid;
      uuid = "";
      topic = "foo";
      obj = {
        topic: "Test",
        data: "This is a test message"
      };
      message = JSON.stringify(obj);
      queue.enqueue(topic, message).then(function() {
        message = JSON.stringify(obj);
        return queue.enqueue(topic, message);
      }).then(function(result) {
        message = JSON.parse(JSON.parse(result[1]).data);
        message.topic.should.equal(obj.topic);
        return message.data.should.equal(obj.data);
      }).then(function() {
        return queue.getPendingQueueSize().then(function(result) {
          result.should.equal(2);
          return done();
        });
      }).catch(function(err) {
        return done(err);
      });
      queue.once("redisrqs:enqueue", function(result) {
        message = JSON.parse(result.message);
        message.topic.should.equal(obj.topic);
        return message.data.should.equal(obj.data);
      });
      return queue.once("foo", function(result) {
        uuid = result.uuid;
        message = JSON.parse(result.message);
        message.topic.should.equal(obj.topic);
        return message.data.should.equal(obj.data);
      });
    });
    it("Requeuing the message should result in a valid pending message", function(done) {
      var message, obj, uuid;
      uuid = "";
      obj = {
        topic: "Test2",
        data: "This is a test message2"
      };
      message = JSON.stringify(obj);
      queue.enqueue("foo2", message).then(function(result) {
        message = JSON.parse(JSON.parse(result[1]).data);
        message.topic.should.equal(obj.topic);
        return message.data.should.equal(obj.data);
      }).then(function() {
        return queue.dequeue().then(function(result) {
          message = JSON.parse(result.message);
          message.topic.should.equal(obj.topic);
          return message.data.should.equal(obj.data);
        });
      }).catch(function(err) {
        return done(err);
      });
      queue.once("redisrqs:requeue", function(result) {
        uuid.should.equal(result);
        return queue.getPendingQueueSize().then(function(count) {
          count.should.equal(1);
          return queue.drainQueues().then(function() {
            return done();
          });
        });
      });
      queue.once("redisrqs:dequeue", function(result) {
        message = JSON.parse(result.message);
        message.data.should.equal(obj.data);
        return queue.requeue(result.uuid);
      });
      return queue.once("foo2", function(result) {
        uuid = result.uuid;
        message = JSON.parse(result.message);
        return message.data.should.equal(obj.data);
      });
    });
    return it("Sweep interval should be honored when creating a RedisRQS instance", function(done) {
      var interval;
      interval = 10000;
      return queue.once("redisrqs:sweep", function() {
        queue.getSweepInterval().should.equal(interval);
        return done();
      });
    });
  });

}).call(this);

//# sourceMappingURL=redisrqsTests.js.map
