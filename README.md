Redis RQS (Reliable Queueing System)
====================================

# Introduction
A Node.js module designed to build a very fast queuing system that guarantees **at least once and at most once delivery**. To achieve this objective, RedisRQS uses Redis as the data store and supports a 1:1 Publisher to Subscriber relationship. When a message arrives, RedisRQS guarantees that only one Subscriber will ever receive a message for processing regardless of the number of Subscribers listening for the same topic in the queue. This should allow a system to scale out the number of processors based on work load.

The way this system handles queuing and dequeuing messages is via Lua scripts. This provides an additional guarantee that each method call to RedisRQS will be a single network call to Redis. Furthermore, RedisRQS also guarantees that messages will never be lost due to a Subscriber unable to finish processing or crashing while processing a message. The queue sweeper will periodically put messages back in to the queue for processing when it runs. You can change the frequency of the sweep in the options.

It is important to note that at this time, there is no support for poison messages. If a message is incomplete or will always crash a Subscriber, the message (poison) will be put back in the pending queue for processing by another Subscriber. This is on the roadmap and will be made available at a future date. As all things open source, your contributions are welcome.

When using this node_module, three lists will be created:

- Pending: named `redisrqs:pending`
- Working: named `redisrqs:working`
- Values: named `redisrqs:values`

**NOTE: All the publicly exposed methods return a Promise object.**

# Install
    npm install redisrqs --save

# Quick start
Presuming that you have an Express application, let's setup a route that will send a message and a listener that will process the message.

``` javascript
var options = {
    redis: { // ioredis options
        port: 6379,
        host: localhost,
        family: 4,
        db: 15
    },
    redisrqs: {
        sweepInterval: 60000    // sweep every 1 minute
    }
};
var RedisRQS = require("redisrqs")
var queue = new RedisRQS(options)

// Add a subscriber for the topic named 'emailWelcomeLetter'
queue.on('emailWelcomeLetter', function(result) {
  var payload, emailBody;
  payload = JSON.parse(result.message);
  emailBody = createWelcomeEmail(payload.email, payload.fullName);
  sendEmail(payload.email, payload.fullName, emailBody);

  // Release the message so we don't process it again.
  queue.release(result.uuid);
});

// Publish the event 'emailWelcomeLetter' to the queue and return
app.post('/register', function(req, res) {}) {
  var email, fullName, message;
  email = req.body.email;
  fullName = req.body.fullName;
  message = {'email': email, 'full_name': fullName};
  queue.enqueue('emailWelcomeLetter', JSON.stringify(message));
  res.redirect('/thank-you');
});
```

# Dependencies
RedisRQS uses [ioredis](https://github.com/luin/ioredis) as the Redis client library. Any valid options
that [ioredis](https://github.com/luin/ioredis) recognizes can be passed in with the `redis` options key.

# Internal Redis Lists
## Pending
When a message is queued it is put in this list. This list will only contain
the UUID of the message. The actual message value lives in the Values list.

## Working
This is where the currently processed message(s) will be stored.

## Values
This is where the actual message will live. Each message is identified
by a UUID. When a message is de-queued, only the UUID is moved from the
Pending list to the Working list.

# Events Emitted
In addition to emitting the topic as an event, it also emits the following
events:

- `redisrqs:enqueue` when a message is queued
- `redisrqs:dequeue` when a message is dequeued
- `redisrqs:release` when a message is released from the queue
- `redisrqs:requeue` when a message is requeued for processing
- `redisrqs:sweep` when the sweeper is run

## redisrqs:sweep
If a worker processing a message dies while processing, reset the message by placing it back
in the pending queue. This is automatically configured when a RedisRQS object is created. The
frequency of the sweeps can be controlled using the `sweepInterval` setting of the `redisrqs`
key in options.

# Methods

## enqueue
Queue the message up.

```
enqueue(topic, message);
```
Example:
```
var obj = {
    "data": "My data"
};
queue.enqueue('MyTopic', JSON.stringify(obj));
```

## release
Remove the message from the queue.
```
release(uuid);
```
Example:
```
queue.release('3e232cd5-0843-4429-93f0-722b7171263d');
```

## requeue
Requeue the message for processing once more.
```
requeue(uuid);
```
Example:
```
queue.requeue('ef50c241-14e6-4349-ba29-be470b94d41d');
```

## drainQueues
Clear the queue entirely. **This is a destructive operation**.
```
drainQueues();
```
Example:
```
queue.drainQueues();
```

## getSweepInterval
Get the interval configured for the sweep.
```
queue.getSweepInterval().then(function(result) {
  console.log('The sweep interval is set to: ' + result);
});
```

## getWorkingQueueSize
Get the number of items in the work queue.
```
queue.getWorkingQueueSize().then(function(result) {
  console.log('The work queue size is: ' + result);
});
```

## getPendingQueueSize
Get the number of items in the pending queue.
```
queue.getPendingQueueSize().then(function(result) {
  console.log('The pending queue size is: ' + result);
});
```
## getValuesQueueSize
Get the number of items in the values queue.
```
queue.getValuesQueueSize().then(function(result) {
  console.log('The values queue size is: ' + result);
});
```

# History
- 1.0.0: Initial public release.
