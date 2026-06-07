require "language/node"

class Filedrop < Formula
  desc "Instantly host a file on a local web server with QR code for mobile transfer"
  homepage "https://github.com/example/filedrop"
  url "https://registry.npmjs.org/filedrop/-/filedrop-1.0.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000" # Update on release
  license "MIT"

  depends_on "node"

  def install
    # Install the npm package into libexec
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    
    # Symlink the binary into the bin directory
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      Note: macOS may prompt to allow network connections for Node.js when you run filedrop.
      Click 'Allow' to enable file transfer across your local network.
    EOS
  end

  test do
    # Verify that the CLI executes and returns the version string
    assert_match "1.0.0", shell_output("#{bin}/filedrop --version")
  end
end
