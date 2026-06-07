#!/usr/bin/env bash
# filedrop stress test script

set -e

echo "Starting filedrop stress tests..."

# Helper to run a test and print PASS/FAIL
run_test() {
  local test_name="$1"
  local command="$2"
  local expect_fail="${3:-0}"

  echo -n "Test: $test_name ... "
  
  if eval "$command" >/dev/null 2>&1; then
    if [ "$expect_fail" -eq 1 ]; then
      echo "FAIL (Expected failure but it succeeded)"
    else
      echo "PASS"
    fi
  else
    if [ "$expect_fail" -eq 1 ]; then
      echo "PASS (Failed as expected)"
    else
      echo "FAIL (Command crashed or returned non-zero exit code)"
    fi
  fi
}

# Ensure filedrop is accessible (assume it's in bin/ or via node)
FILEDROP_CMD="node $(dirname $0)/../bin/filedrop.js"

# Create temp files
TEST_DIR=$(mktemp -d)
echo -n "1" > "$TEST_DIR/1byte.txt"
dd if=/dev/zero of="$TEST_DIR/100mb.bin" bs=1M count=100 >/dev/null 2>&1

echo "1. Testing 1-byte file (minimum case)"
run_test "1-byte file" "$FILEDROP_CMD $TEST_DIR/1byte.txt --timeout 1 & sleep 1; kill -SIGINT \$!"

echo "2. Testing 100MB file (large file)"
run_test "100MB file" "$FILEDROP_CMD $TEST_DIR/100mb.bin --timeout 1 & sleep 1; kill -SIGINT \$!"

echo "3. Testing SIGINT immediately (no transfer)"
run_test "SIGINT immediately" "$FILEDROP_CMD $TEST_DIR/1byte.txt & sleep 0.2; kill -SIGINT \$!"

echo "4. Testing --timeout 1 and waiting (timeout case)"
# Should exit with code 5, so we expect a failure exit code
run_test "Timeout case" "$FILEDROP_CMD $TEST_DIR/1byte.txt --timeout 1" 1

echo "5. Testing port conflict scenario"
run_test "Port conflict" "$FILEDROP_CMD $TEST_DIR/1byte.txt --port 8000 & sleep 0.5; $FILEDROP_CMD $TEST_DIR/1byte.txt --port 8000" 1

echo "6. Testing --no-qr (URL-only mode)"
run_test "--no-qr mode" "$FILEDROP_CMD $TEST_DIR/1byte.txt --no-qr --timeout 1 & sleep 1; kill -SIGINT \$!"

echo "7. Testing NO_COLOR=1"
run_test "NO_COLOR=1 mode" "NO_COLOR=1 $FILEDROP_CMD $TEST_DIR/1byte.txt --timeout 1 & sleep 1; kill -SIGINT \$!"

echo "8. Testing --verbose mode"
run_test "--verbose mode" "$FILEDROP_CMD $TEST_DIR/1byte.txt --verbose --timeout 1 & sleep 1; kill -SIGINT \$!"

# Cleanup
rm -rf "$TEST_DIR"
echo "Stress tests complete."
