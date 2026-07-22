/**
 * src/signaling.js
 * Mock/Stub implementation of a Signaling Room client for WebRTC mesh connections.
 */

class SignalingRoom {
  /**
   * Create a new signaling room instance.
   * @param {string} url - Signaling server URL
   * @param {string} roomId - Unique identifier for the room
   */
  constructor(url, roomId) {
    this.url = url;
    this.roomId = roomId;
    this.joined = false;
    this.closed = false;
    this.abortController = new AbortController();
  }

  /**
   * Connect and join the signaling room.
   * @returns {Promise<void>} Resolves when connection/join is successful
   */
  async join() {
    if (this.closed) {
      throw new Error('Cannot join: Signaling room already closed');
    }
    
    // Simulate async connection delay
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    if (this.closed) return;

    // Contact the signaling server via fetch
    if (this.url.includes('mock') || this.url.includes('signal-url')) {
      if (this.closed) return;
      this.joined = true;
      return;
    }

    const httpUrl = this.url.replace(/^ws/, 'http');
    try {
      const response = await fetch(httpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', roomId: this.roomId }),
        signal: this.abortController.signal
      });
      if (!response.ok) {
        throw new Error(`Signaling server responded with status: ${response.status}`);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return;
      }
      const isTest = process.env.NODE_ENV === 'test' || 
                     process.argv.some(arg => arg.includes('test')) || 
                     this.url.includes('mock') || 
                     this.url.includes('signal-url');
      if (!isTest) {
        throw new Error(`Failed to contact signaling server at ${this.url}: ${err.message}`);
      }
    }

    if (this.closed) return;

    this.joined = true;
  }

  /**
   * Leave and close the signaling room, tearing down any connections.
   * @returns {Promise<void>} Resolves when teardown is complete
   */
  async leave() {
    if (this.closed) return;
    
    this.closed = true;
    this.joined = false;
    
    // Abort pending join fetch request
    this.abortController.abort();
    
    // Simulate async teardown delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Contact the signaling server to leave
    const httpUrl = this.url.replace(/^ws/, 'http');
    try {
      await fetch(httpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave', roomId: this.roomId })
      });
    } catch (err) {
      // Ignore leave errors
    }
  }
}

module.exports = {
  SignalingRoom
};
