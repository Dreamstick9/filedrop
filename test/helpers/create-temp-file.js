const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const createdFiles = new Set();

/**
 * Creates a temporary file of the specified size and content.
 * @param {number} sizeBytes - Size of the file in bytes.
 * @param {string} [extension='.tmp'] - File extension.
 * @returns {string} Absolute path to the created file.
 */
function createTempFile(sizeBytes, extension = '.tmp') {
  const fileName = `filedrop-test-${crypto.randomBytes(4).toString('hex')}${extension}`;
  const filePath = path.join(os.tmpdir(), fileName);
  
  const buffer = crypto.randomBytes(sizeBytes);
  fs.writeFileSync(filePath, buffer);
  
  createdFiles.add(filePath);
  return filePath;
}

/**
 * Cleans up all created temporary files.
 * Typically called in a test afterEach or afterAll hook.
 */
function cleanupTempFiles() {
  for (const filePath of createdFiles) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`Failed to cleanup temp file: ${filePath}`, err);
    }
  }
  createdFiles.clear();
}

module.exports = {
  createTempFile,
  cleanupTempFiles
};
