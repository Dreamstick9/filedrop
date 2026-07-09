// Import the Mutex class from the async-mutex library
const Mutex = require('async-mutex').Mutex;

// Create a lock instance to synchronize access to the activeIPs Set
const lock = new Mutex();

// Define the activeIPs Set
let activeIPs = new Set();

// Define the completedIPs Set
let completedIPs = new Set();

// Define the downloadLimit
const downloadLimit = 1;

// Define the http server
const http = require('http');
const server = http.createServer((req, res) => {
  // ...

  // Check if the client IP is in the activeIPs Set
  if (activeIPs.has(clientIp)) {
    // ...
  } else {
    // Add the client IP to the activeIPs Set
    lock.runExclusive(() => {
      activeIPs.add(clientIp);
    });
  }

  // ...
});

// Define the socket close callback
server.on('close', (socket) => {
  // Remove the client IP from the activeIPs Set
  lock.runExclusive(() => {
    activeIPs.delete(clientIp);
  });
});

// ...