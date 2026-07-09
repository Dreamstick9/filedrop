// Import the required modules
const http = require('http');
const server = require('./server');
const Mutex = require('async-mutex').Mutex;

// Create a test client IP
const clientIp = '192.168.1.100';

// Create a test activeIPs Set
const activeIPs = new Set();

// Create a test completedIPs Set
const completedIPs = new Set();

// Test the second download
test('second download', async () => {
  // Create a lock instance
  const lock = new Mutex();

  // Acquire the lock
  await lock.acquire();

  // Add the client IP to the activeIPs Set
  activeIPs.add(clientIp);

  // Release the lock
  lock.release();

  // Create a test request
  const req = {
    headers: {
      'client-ip': clientIp,
    },
  };

  // Send the request
  const res = await sendRequest(req);

  // Check if the response is OK
  expect(res.statusCode).toBe(200);

  // Remove the client IP from the activeIPs Set
  activeIPs.delete(clientIp);

  // Check if the client IP is not in the activeIPs Set
  expect(activeIPs.has(clientIp)).toBe(false);
});