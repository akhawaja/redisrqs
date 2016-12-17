(function () {
  "use strict";

  var RedisRQS, assert, chai, queue, should;

  chai = require("chai");
  assert = chai.assert;
  should = chai.should();
  RedisRQS = require("../index");

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

  describe("RedisRQS Tests:", function () {
    after(function (done) {
      queue.drainQueues().then(function (result) {
        done();
      });
    });

    beforeEach(function (done) {
      queue.drainQueues().then(function (result) {
        done();
      });
    });

    it("Should be a class of type RedisRQS", function (done) {
      assert.instanceOf(queue, RedisRQS);
      return done();
    });

    it("Should contain identifiable queue names", function (done) {
      assert.equal('redisrqs:pending', queue.getQueueNames().pending);
      return done();
    });

    it("Working queue should be empty", function (done) {
      return queue.getWorkingQueueSize().then(function (result) {
        result.should.equal(0);
        return done();
      });
    });

    it("Pending queue should be empty", function (done) {
      return queue.getPendingQueueSize().then(function (result) {
        result.should.equal(0);
        return done();
      });
    });

    it("Values queue should be empty", function (done) {
      return queue.getValuesQueueSize().then(function (result) {
        result.should.equal(0);
        return done();
      });
    });

    it("Pending queue should contain a valid message when queued", function (done) {
      var message, obj, uuid;
      uuid = "";
      obj = {
        topic: "Test",
        data: "This is a test message"
      };
      message = JSON.stringify(obj);

      queue.enqueue('foo', message)
        .then(function (result) {
          var message;
          message = JSON.parse((JSON.parse(result[1])).data);
          message.topic.should.equal(obj.topic);
          message.data.should.equal(obj.data);
        });

      queue.once("redisrqs:enqueue", function (result) {
        var message;
        message = JSON.parse(result.message);
        message.topic.should.equal(obj.topic);
        message.data.should.equal(obj.data);
      });

      queue.once("redisrqs:dequeue", function (result) {
        var message;
        message = JSON.parse(result.message);
        message.topic.should.equal(obj.topic);
        message.data.should.equal(obj.data);
        queue.release(result.uuid);
      });

      queue.once("redisrqs:release", function (result) {
        result.should.have.length.above(0);
        return queue.getWorkingQueueSize().then(function (count) {
          count.should.equal(0);
          done();
        });
      });

      queue.once("foo", function (result) {
        var message;
        uuid = result.uuid;
        message = JSON.parse(result.message);
        message.topic.should.equal(obj.topic);
        message.data.should.equal(obj.data);
        queue.release(uuid);
      });
    });

    it("Requeuing the message should result in a valid pending message", function (done) {
      var message, obj, uuid;
      uuid = "";
      obj = {
        topic: "Test2",
        data: "This is a test message2"
      };
      message = JSON.stringify(obj);

      queue.enqueue("foo2", message)
        .then(function (result) {
          message = JSON.parse((JSON.parse(result[1])).data);
          message.topic.should.equal(obj.topic);
          message.data.should.equal(obj.data);
        })
        .catch(function (err) {
          console.log('Err: ' + err);
        });

      queue.once("redisrqs:requeue", function (result) {
        uuid.should.equal(result);
        queue.getWorkingQueueSize().then(function (count) {
          count.should.equal(1);
          done();
        });
      });

      queue.once("redisrqs:dequeue", function (result) {
        var message;
        message = JSON.parse(result.message);
        message.data.should.equal(obj.data);
        queue.requeue(result.uuid);
      });

      queue.once("foo2", function (result) {
        uuid = result.uuid;
        var message;
        message = JSON.parse(result.message);
        message.data.should.equal(obj.data);
      });
    });

    it("Sweep interval should be honored when creating a RedisRQS instance", function (done) {
      var interval, localQueue, timesRun;
      interval = 100;
      timesRun = 0;
      localQueue = new RedisRQS({
        redis: {
          port: 6379,
          host: "127.0.0.1",
          family: 4,
          db: 15
        },
        redisrqs: {
          sweepInterval: interval
        }
      });
      localQueue.on("redisrqs:sweep", function () {
        ++timesRun;
        if (timesRun === 10) {
          localQueue.getSweepInterval().should.equal(interval);
          return done();
        }
      });
    });
  });

}).call(this);
