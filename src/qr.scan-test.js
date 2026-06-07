const assert = require('assert');
const { renderQR } = require('./qr');
const jsQR = require('jsqr');

// We need to parse the ANSI output back into an RGBA array for jsQR
// This validates our ANSI half-block rendering logic.

function parseAnsiQR(ansiString) {
  const lines = ansiString.split('\n');
  
  const stripAnsi = (str) => str.replace(/\x1b\[\d+m/g, '');
  const widthInChars = stripAnsi(lines[0]).length;
  const heightInPixels = lines.length * 2;
  
  // jsQR prefers larger scale to avoid artifacts
  const SCALE = 4;
  const imgWidth = widthInChars * SCALE;
  const imgHeight = heightInPixels * SCALE;
  const imgData = new Uint8ClampedArray(imgWidth * imgHeight * 4);
  
  // Fill with white first
  for (let i = 0; i < imgData.length; i += 4) {
    imgData[i] = 255;
    imgData[i+1] = 255;
    imgData[i+2] = 255;
    imgData[i+3] = 255;
  }

  function setPixel(x, y, isDark) {
    for (let dy = 0; dy < SCALE; dy++) {
      for (let dx = 0; dx < SCALE; dx++) {
        const px = x * SCALE + dx;
        const py = y * SCALE + dy;
        const idx = (py * imgWidth + px) * 4;
        const val = isDark ? 0 : 255;
        imgData[idx] = val;
        imgData[idx+1] = val;
        imgData[idx+2] = val;
        imgData[idx+3] = 255;
      }
    }
  }

  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    let col = 0;
    
    // State machine for ANSI
    let bgIsDark = false; 
    let fgIsDark = false; 
    
    let i = 0;
    while (i < line.length) {
      if (line[i] === '\x1b') {
        const m = line.slice(i).match(/^\x1b\[(\d+)m/);
        if (m) {
          const code = parseInt(m[1], 10);
          if (code === 0) {
            bgIsDark = false;
            fgIsDark = false;
          } else if (code === 40) {
            bgIsDark = true;
          } else if (code === 47) {
            bgIsDark = false;
          } else if (code === 30) {
            fgIsDark = true;
          } else if (code === 37) {
            fgIsDark = false;
          }
          i += m[0].length;
          continue;
        }
      }
      
      const char = line[i];
      let topIsDark = false;
      let bottomIsDark = false;
      
      if (char === ' ') {
        topIsDark = bgIsDark;
        bottomIsDark = bgIsDark;
      } else if (char === '▄') {
        topIsDark = bgIsDark;
        bottomIsDark = fgIsDark;
      } else if (char === '▀') {
        topIsDark = fgIsDark;
        bottomIsDark = bgIsDark;
      } else if (char === '█') {
        topIsDark = fgIsDark;
        bottomIsDark = fgIsDark;
      }
      
      setPixel(col, r * 2, topIsDark);
      setPixel(col, r * 2 + 1, bottomIsDark);
      
      col++;
      i++;
    }
  }
  
  return { data: imgData, width: imgWidth, height: imgHeight };
}

function runTest() {
  console.log('Running QR Scan Reliability Test...');
  const testUrl = 'http://192.168.1.42:8432/filedrop-test-123';
  
  // Force TTY and color for testing ANSI output
  const oldIsTTY = process.stdout.isTTY;
  process.stdout.isTTY = true;
  process.env.TERM = 'xterm-256color';
  delete process.env.NO_COLOR;
  
  const qrString = renderQR(testUrl, { compact: true });
  
  const image = parseAnsiQR(qrString);
  
  const decoded = jsQR(image.data, image.width, image.height);
  
  process.stdout.isTTY = oldIsTTY; // restore
  
  if (!decoded) {
    console.error('jsQR failed to decode the generated QR code!');
    process.exit(1);
  }
  
  if (decoded.data !== testUrl) {
    console.error(`Decoded URL mismatch! Expected: ${testUrl}, Got: ${decoded.data}`);
    process.exit(1);
  }
  
  console.log('Test Passed: ANSI block QR code was successfully rendered and decoded!');
}

if (require.main === module) {
  runTest();
}

module.exports = { parseAnsiQR };
