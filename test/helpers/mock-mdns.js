/**
 * Mock mDNS module for tests that don't need real network broadcasting.
 */

const mockMdns = {
  register: async (options) => {
    // simulate successful registration
    return Promise.resolve();
  },
  deregister: async () => {
    // simulate successful deregistration
    return Promise.resolve();
  }
};

module.exports = mockMdns;
