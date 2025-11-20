const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const REPOS_DIR = process.env.REPOS_DIR || path.join(__dirname, 'repos');

// Middleware to parse raw body for signature validation
app.use('/webhook', express.raw({ type: 'application/json' }));

// Load or generate webhook configuration
const CONFIG_FILE = path.join(__dirname, 'webhook-config.json');
let config = loadOrCreateConfig();

function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading config file:', err.message);
    }
  }

  // Generate new config
  const newConfig = {
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  console.log('Created new webhook configuration at:', CONFIG_FILE);
  console.log('GitHub Webhook Secret:', newConfig.githubWebhookSecret);

  return newConfig;
}

// Validate GitHub webhook signature
function validateGitHubSignature(payload, signature) {
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', config.githubWebhookSecret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    );
  } catch (err) {
    return false;
  }
}

// Execute git pull in repository directory
function gitPull(repoPath) {
  return new Promise((resolve, reject) => {
    const gitCommand = 'git pull origin';

    exec(gitCommand, { cwd: repoPath }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr });
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// Check for SSH key and generate if needed
function checkAndSetupSSHKey() {
  return new Promise((resolve, reject) => {
    const sshDir = '/root/.ssh';
    const keyTypes = [
      { private: 'id_ed25519', public: 'id_ed25519.pub' },
      { private: 'id_rsa', public: 'id_rsa.pub' }
    ];

    // Check if .ssh directory exists
    if (!fs.existsSync(sshDir)) {
      console.log('SSH directory not found, creating:', sshDir);
      fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    }

    // Check for existing SSH keys
    let existingKey = null;
    for (const keyType of keyTypes) {
      const privateKeyPath = path.join(sshDir, keyType.private);
      const publicKeyPath = path.join(sshDir, keyType.public);

      if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
        existingKey = { type: keyType.private, publicPath: publicKeyPath };
        break;
      }
    }

    if (existingKey) {
      // SSH key already exists
      console.log('Found existing SSH key:', existingKey.type);
      const publicKey = fs.readFileSync(existingKey.publicPath, 'utf8').trim();
      console.log('');
      console.log('SSH Public Key:');
      console.log('-'.repeat(60));
      console.log(publicKey);
      console.log('-'.repeat(60));
      console.log('Add this key to your GitHub account (Settings > SSH Keys)');
      console.log('');
      resolve({ exists: true, publicKey });
    } else {
      // No SSH key found, generate new one
      console.log('No SSH key found, generating new ed25519 key...');
      const privateKeyPath = path.join(sshDir, 'id_ed25519');
      const publicKeyPath = path.join(sshDir, 'id_ed25519.pub');

      const sshKeygenCommand = `ssh-keygen -t ed25519 -f ${privateKeyPath} -N "" -C "github-webhook-server"`;

      exec(sshKeygenCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('Failed to generate SSH key:', error.message);
          reject(error);
          return;
        }

        console.log('SSH key generated successfully!');

        // Set correct permissions
        fs.chmodSync(privateKeyPath, 0o600);
        fs.chmodSync(publicKeyPath, 0o644);

        const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
        console.log('');
        console.log('NEW SSH Public Key Generated:');
        console.log('='.repeat(60));
        console.log(publicKey);
        console.log('='.repeat(60));
        console.log('IMPORTANT: Add this key to your GitHub account!');
        console.log('Go to: https://github.com/settings/ssh/new');
        console.log('');

        resolve({ exists: false, publicKey });
      });
    }
  });
}

// Ensure repos directory exists
if (!fs.existsSync(REPOS_DIR)) {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  console.log('Created repos directory at:', REPOS_DIR);
}

// GitHub webhook endpoint
app.post('/webhook', async (req, res) => {
  // Validate GitHub signature
  const signature = req.headers['x-hub-signature-256'];
  if (!validateGitHubSignature(req.body, signature)) {
    console.log('Invalid GitHub signature - request rejected');
    return res.status(401).json({ error: 'Unauthorized - Invalid GitHub signature' });
  }

  // Parse the payload
  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch (err) {
    console.error('Error parsing payload:', err.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // Extract repository information
  const repoName = payload.repository?.name;
  const event = req.headers['x-github-event'];

  if (!repoName) {
    console.log('No repository name in payload');
    return res.status(400).json({ error: 'No repository name found' });
  }

  console.log(`Received ${event} event for repository: ${repoName}`);

  // Check if repository directory exists
  const repoPath = path.join(REPOS_DIR, repoName);

  if (!fs.existsSync(repoPath)) {
    console.log(`Repository directory not found: ${repoPath}`);
    return res.status(404).json({
      error: 'Repository directory not found',
      message: `Please clone the repository to ${repoPath} first`
    });
  }

  // Check if it's a git repository
  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log(`Not a git repository: ${repoPath}`);
    return res.status(400).json({
      error: 'Not a git repository',
      message: `${repoPath} exists but is not a git repository`
    });
  }

  // Perform git pull
  try {
    console.log(`Pulling changes for ${repoName}...`);
    const result = await gitPull(repoPath);

    console.log(`Git pull successful for ${repoName}`);
    console.log('Output:', result.stdout);

    res.json({
      success: true,
      repository: repoName,
      output: result.stdout,
      message: 'Repository updated successfully'
    });
  } catch (err) {
    console.error(`Git pull failed for ${repoName}:`, err.error?.message || err.stderr);

    res.status(500).json({
      success: false,
      repository: repoName,
      error: err.error?.message || 'Git pull failed',
      stderr: err.stderr
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    reposDir: REPOS_DIR,
    timestamp: new Date().toISOString()
  });
});

// Info endpoint (non-sensitive information)
app.get('/', (req, res) => {
  res.json({
    message: 'GitHub Webhook Git Pull Server',
    endpoints: {
      webhook: '/webhook (POST)',
      health: '/health (GET)'
    },
    reposDir: REPOS_DIR
  });
});

// Start the server
async function startServer() {
  try {
    // Check and setup SSH key
    const sshKeyInfo = await checkAndSetupSSHKey();

    // Start listening
    app.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log('GitHub Webhook Git Pull Server');
      console.log('='.repeat(60));
      console.log(`Server running on port ${PORT}`);
      console.log(`Repositories directory: ${REPOS_DIR}`);
      console.log('');
      console.log('Webhook Configuration:');
      console.log('  Webhook URL:', `http://localhost:${PORT}/webhook`);
      console.log('  GitHub Webhook Secret:', config.githubWebhookSecret);
      console.log('');
      console.log('SSH Public Key (add to GitHub):');
      console.log('-'.repeat(60));
      console.log(sshKeyInfo.publicKey);
      console.log('-'.repeat(60));
      console.log('');
      console.log('Next Steps:');
      console.log('1. Add the SSH public key above to GitHub:');
      console.log('   https://github.com/settings/ssh/new');
      console.log('2. Clone repositories to:', REPOS_DIR);
      console.log('3. Configure webhook URL and secret in GitHub settings');
      console.log('='.repeat(60));
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
