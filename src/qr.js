const qrcode = require('qrcode');

const platform = require('./platform');

/**
 * Checks if the terminal supports color.
 */
function supportsColor() {
  return platform.supportsAnsi();
}

/**
 * Generates the QR code bit matrix.
 * @param {string} url - The URL to encode.
 * @returns {Array<Array<number>>} The bit matrix (1 for dark, 0 for light).
 */
function generateMatrix(url) {
  const qr = qrcode.create(url, {
    errorCorrectionLevel: 'M',
    margin: 0
  });
  
  const size = qr.modules.size;
  const data = qr.modules.data;
  
  const matrix = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      row.push(data[r * size + c] ? 1 : 0);
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * Renders the QR code using ANSI blocks or ASCII fallback.
 * @param {string} url - The URL to encode.
 * @param {object} options - Options object.
 * @returns {string} The rendered QR code.
 */
function renderQR(url, options = {}) {
  const { compact = false, noQr = false, color = supportsColor() } = options;
  const isTTY = process.stdout.isTTY;
  const columns = process.stdout.columns || 80;

  if (!isTTY) {
    return `\n${url}\n(non-interactive terminal — QR code suppressed)\n`;
  }

  if (noQr) {
    return `\n${url}\n`;
  }

  if (columns < 30) {
    console.warn('Warning: Terminal width < 30. QR code suppressed.');
    return `\n${url}\n`;
  }

  const matrix = generateMatrix(url);
  const size = matrix.length;
  
  const quietZoneX = 2; // 2 characters wide
  const quietZoneY = 2; // 2 modules high (1 terminal row)
  
  const width = size + 2 * quietZoneX;
  const height = size + 2 * quietZoneY;
  
  if (width > columns - 4) {
    console.warn(`Warning: Terminal too narrow for optimal QR display. Please widen to at least ${width + 4} columns.`);
  }

  const expanded = [];
  for (let r = 0; r < height; r++) {
    const row = [];
    for (let c = 0; c < width; c++) {
      if (r < quietZoneY || r >= size + quietZoneY || c < quietZoneX || c >= size + quietZoneX) {
        row.push(0); // light module for quiet zone
      } else {
        row.push(matrix[r - quietZoneY][c - quietZoneX]);
      }
    }
    expanded.push(row);
  }

  let output = '';

  if (!color) {
    if (!compact) {
      output += '(no-color mode — scan may be less reliable)\n';
    }
    for (let r = 0; r < height; r++) {
      let line = '';
      for (let c = 0; c < width; c++) {
        line += expanded[r][c] ? '##' : '  ';
      }
      output += line + '\n';
    }
  } else {
    for (let r = 0; r < height; r += 2) {
      let line = '';
      for (let c = 0; c < width; c++) {
        const top = expanded[r][c];
        const bottom = r + 1 < height ? expanded[r + 1][c] : 0;

        if (top === 0 && bottom === 0) {
          line += '\x1b[47m \x1b[0m'; // Both light -> white bg
        } else if (top === 1 && bottom === 0) {
          line += '\x1b[40m\x1b[37m▄\x1b[0m'; // Top dark (black bg), bottom light (white fg on lower half)
        } else if (top === 0 && bottom === 1) {
          line += '\x1b[40m\x1b[37m▀\x1b[0m'; // Top light (white fg on upper half), bottom dark (black bg)
        } else if (top === 1 && bottom === 1) {
          line += '\x1b[40m \x1b[0m'; // Both dark -> black bg
        }
      }
      output += line + '\n';
    }
  }

  return output.replace(/\n$/, ''); // Trim last newline
}

/**
 * Renders the metadata box.
 * @param {string} filename 
 * @param {string} sizeHuman 
 * @param {string} url 
 * @param {string} mdnsName 
 * @param {object} options
 * @returns {{ output: string, boxWidth: number }} An object containing the formatted metadata box string and its inner width.
 */
function renderMetadataBox(filename, sizeHuman, url, mdnsName, options = {}) {
  const { color = supportsColor() } = options;
  
  const l1Len = 6 + filename.length + 2 + sizeHuman.length;
  const l2Len = 6 + url.length;
  const l3Len = mdnsName ? 6 + mdnsName.length + 6 : 0; // 6 for ".local"
  const l4Len = 6 + 25; // "Waiting for connection..."
  
  const boxInnerWidth = Math.max(43, l1Len, l2Len, l3Len, l4Len);
  
  let output = '';
  if (color) {
    output += `  ┌${'─'.repeat(boxInnerWidth)}┐\n`;
    
    // Line 1
    const padding1 = boxInnerWidth - (6 + filename.length + sizeHuman.length);
    output += `  │  📁  ${filename}${' '.repeat(Math.max(0, padding1))}${sizeHuman} │\n`;
    
    // Line 2
    const padding2 = boxInnerWidth - l2Len;
    output += `  │  🌐  ${url}${' '.repeat(Math.max(0, padding2))}│\n`;
    
    // Line 3
    if (mdnsName) {
      const padding3 = boxInnerWidth - l3Len;
      output += `  │  📡  ${mdnsName}.local${' '.repeat(Math.max(0, padding3))}│\n`;
    }
    
    // Line 4
    const padding4 = boxInnerWidth - l4Len;
    output += `  │  ⏳  Waiting for connection...${' '.repeat(Math.max(0, padding4))}│\n`;
    
    output += `  └${'─'.repeat(boxInnerWidth)}┘\n`;
  } else {
    output += `  +${'-'.repeat(boxInnerWidth)}+\n`;
    
    const plainPrefixLen = 10; // "  [File]  ".length = 10
    const pl1Len = plainPrefixLen + filename.length + sizeHuman.length;
    const padding1 = boxInnerWidth - pl1Len;
    output += `  |  [File]  ${filename}${' '.repeat(Math.max(0, padding1))}${sizeHuman} |\n`;
    
    const pl2Len = 10 + url.length;
    const padding2 = boxInnerWidth - pl2Len;
    output += `  |  [URL]   ${url}${' '.repeat(Math.max(0, padding2))}|\n`;
    
    if (mdnsName) {
      const pl3Len = 10 + mdnsName.length + 6;
      const padding3 = boxInnerWidth - pl3Len;
      output += `  |  [mDNS]  ${mdnsName}.local${' '.repeat(Math.max(0, padding3))}|\n`;
    }
    
    const pl4Len = 10 + 25;
    const padding4 = boxInnerWidth - pl4Len;
    output += `  |  [Wait]  Waiting for connection...${' '.repeat(Math.max(0, padding4))}|\n`;
    
    output += `  +${'-'.repeat(boxInnerWidth)}+\n`;
  }
  
  return { output, boxWidth: boxInnerWidth };
}

/**
 * Updates the transfer status in the terminal.
 * @param {string} status
 * @param {object} options
 * @param {number} [boxWidth=43] - The explicit width of the box for padding calculation.
 */
function updateStatus(status, options = {}) {
  // Capture boxWidth explicitly if supplied as the 3rd argument, otherwise default to 43
  const boxWidth = arguments[2] !== undefined ? arguments[2] : 43;

  if (!process.stdout.isTTY) return;
  const { color = supportsColor() } = options;
  
  let prefix, msg, msgLen;
  if (status.startsWith('transferring') || status.startsWith('Downloads:')) {
    prefix = color ? `  │  ⬇️  ` : `  |  [Wait]  `;
    msg = status;
    msgLen = color ? 6 + msg.length : 10 + msg.length;
  } else if (status === 'done') {
    prefix = color ? `  │  ✅  ` : `  |  [Done]  `;
    msg = `Done. Goodbye.`;
    msgLen = color ? 6 + msg.length : 10 + msg.length;
  } else {
    prefix = color ? `  │  ℹ️  ` : `  |  [Info]  `;
    msg = status;
    msgLen = color ? 6 + msg.length : 10 + msg.length;
  }
  
  const padding = Math.max(0, boxWidth - msgLen);
  const suffix = color ? ` │` : ` |`;
  const line = `${prefix}${msg}${' '.repeat(padding)}${suffix}`;
  
  // Go up 2 lines, write, go down 2 lines
  process.stdout.write(`\x1b[2A\r${line}\x1b[2B\r`);
}

module.exports = {
  renderQR,
  renderMetadataBox,
  updateStatus
};