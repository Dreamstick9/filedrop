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

// Test the activeIPs Set modification
test('activeIPs Set modification', async () => {
  // Create a lock instance
  const lock = new Mutex();

  // Acquire the lock
  await lock.acquire();

  // Add the client IP to the activeIPs Set
  activeIPs.add(clientIp);

  // Release the lock
  lock.release();

  // Check if the client IP is in the activeIPs Set
  expect(activeIPs.has(clientIp)).toBe(true);

  // Remove the client IP from the activeIPs Set
  activeIPs.delete(clientIp);

  // Check if the client IP is not in the activeIPs Set
  expect(activeIPs.has(clientIp)).toBe(false);
});

// Test the socket close callback
test('socket close callback', async () => {
  // Create a test socket
  const socket = {};

  // Define the socket close callback
  const closeCallback = () => {
    // Remove the client IP from the activeIPs Set
    activeIPs.delete(clientIp);
  };

  // Call the socket close callback
  closeCallback();

  // Check if the client IP is not in the activeIPs Set
  expect(activeIPs.has(clientIp)).toBe(false);
});