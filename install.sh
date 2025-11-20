#!/bin/bash
set -e

# GitHub Webhook Git Pull Server - Installation Script
# This script sets up the webhook server in a Node.js Docker container

echo "============================================================"
echo "GitHub Webhook Git Pull Server - Installation"
echo "============================================================"
echo ""

# Configuration
REPO_URL="${REPO_URL:-https://github.com/oOHiyoriOo/docker-git-pull.git}"
INSTALL_DIR="${INSTALL_DIR:-.}"
BRANCH="${BRANCH:-main}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${YELLOW}→${NC} $1"
}

# Check if running as root (common in containers)
if [ "$EUID" -ne 0 ] && [ -z "$SKIP_ROOT_CHECK" ]; then
    print_info "Not running as root. Some operations may require sudo."
    SUDO="sudo"
else
    SUDO=""
fi

# Check for Node.js
print_info "Checking for Node.js..."
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed!"
    echo "This script requires Node.js. Please run this in a Node.js container or install Node.js first."
    exit 1
fi
NODE_VERSION=$(node --version)
print_success "Node.js found: $NODE_VERSION"

# Check for npm
print_info "Checking for npm..."
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed!"
    exit 1
fi
NPM_VERSION=$(npm --version)
print_success "npm found: $NPM_VERSION"

# Install git if not present
print_info "Checking for git..."
if ! command -v git &> /dev/null; then
    print_info "Git not found. Installing git..."

    # Detect package manager
    if command -v apt-get &> /dev/null; then
        print_info "Using apt-get to install git..."
        $SUDO apt-get update -qq
        $SUDO apt-get install -y git
    elif command -v apk &> /dev/null; then
        print_info "Using apk to install git..."
        $SUDO apk add --no-cache git
    elif command -v yum &> /dev/null; then
        print_info "Using yum to install git..."
        $SUDO yum install -y git
    else
        print_error "Could not detect package manager. Please install git manually."
        exit 1
    fi

    print_success "Git installed successfully"
else
    GIT_VERSION=$(git --version)
    print_success "Git found: $GIT_VERSION"
fi

# Install OpenSSH client if not present (needed for SSH key generation)
print_info "Checking for SSH..."
if ! command -v ssh-keygen &> /dev/null; then
    print_info "SSH tools not found. Installing openssh-client..."

    if command -v apt-get &> /dev/null; then
        $SUDO apt-get install -y openssh-client
    elif command -v apk &> /dev/null; then
        $SUDO apk add --no-cache openssh-client
    elif command -v yum &> /dev/null; then
        $SUDO yum install -y openssh-clients
    fi

    print_success "SSH tools installed"
else
    print_success "SSH tools found"
fi

# Setup installation directory
if [ "$INSTALL_DIR" = "." ]; then
    print_info "Installing into current directory: $(pwd)"

    if [ -d ".git" ]; then
        print_info "Existing git repository found. Updating..."
        git fetch origin
        git reset --hard origin/$BRANCH
        print_success "Updated to latest version"
    else
        # Check if directory is not empty (excluding hidden files)
        if [ "$(ls -A | grep -v '^\.')" ]; then
            print_error "Current directory is not empty and not a git repository!"
            echo "Please run this script in an empty directory or set INSTALL_DIR to a different location."
            exit 1
        fi

        print_info "Cloning repository into current directory..."
        git clone -b "$BRANCH" "$REPO_URL" .
        print_success "Repository cloned"
    fi
else
    print_info "Setting up installation directory: $INSTALL_DIR"
    if [ -d "$INSTALL_DIR" ]; then
        print_info "Directory exists. Checking for existing installation..."

        if [ -d "$INSTALL_DIR/.git" ]; then
            print_info "Existing installation found. Updating..."
            cd "$INSTALL_DIR"
            git fetch origin
            git reset --hard origin/$BRANCH
            print_success "Updated to latest version"
        else
            print_info "Directory exists but no git repository found. Cleaning and cloning..."
            $SUDO rm -rf "$INSTALL_DIR"
            $SUDO mkdir -p "$INSTALL_DIR"
            git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
            cd "$INSTALL_DIR"
            print_success "Repository cloned"
        fi
    else
        print_info "Creating directory and cloning repository..."
        $SUDO mkdir -p "$INSTALL_DIR"
        git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
        print_success "Repository cloned"
    fi
fi

# Install dependencies
print_info "Installing npm dependencies..."
npm install --production
print_success "Dependencies installed"

# Create repos directory
print_info "Creating repos directory..."
mkdir -p repos
print_success "Repos directory created"

echo ""
echo "============================================================"
echo "Installation Complete!"
echo "============================================================"
echo ""
if [ "$INSTALL_DIR" = "." ]; then
    echo "Installation directory: $(pwd)"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Start the server:"
    echo "   npm start"
else
    echo "Installation directory: $INSTALL_DIR"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Start the server:"
    echo "   cd $INSTALL_DIR && npm start"
fi
echo ""
echo "2. The server will:"
echo "   - Generate SSH keys if needed"
echo "   - Display the SSH public key (add to GitHub)"
echo "   - Show the webhook URL and secret"
echo ""
echo "3. Configure GitHub webhook:"
echo "   - Add the SSH key to: https://github.com/settings/ssh/new"
echo "   - Set up webhook in your repository settings"
echo ""
echo "Optional environment variables:"
echo "  PORT=3000                    # Server port (default: 3000)"
echo "  REPOS_DIR=/app/repos         # Repository directory"
echo "  DEFAULT_BRANCH=main          # Default branch for cloning"
echo "  AUTO_CLONE=true              # Enable auto-cloning"
echo "  GITHUB_WEBHOOK_SECRET=xxx    # Webhook secret (or auto-generated)"
echo ""
echo "Example with environment variables:"
echo "  PORT=8080 npm start"
echo ""
echo "For background execution, use a process manager like PM2:"
echo "  npm install -g pm2"
echo "  pm2 start server.js --name webhook-server"
echo ""
echo "============================================================"
