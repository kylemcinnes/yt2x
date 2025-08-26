# Deployment Guide for yt2x

This guide will help you deploy yt2x to a VPS using GitHub Actions for automatic deployment.

## Prerequisites

- A VPS with Ubuntu/Debian (tested on Ubuntu 22.04+)
- Docker and Docker Compose installed
- SSH access to the server
- GitHub repository with yt2x code

## Step 1: Server Setup

### Install Docker and Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install -y docker-compose-plugin

# Log out and back in for group changes to take effect
exit
# SSH back in
```

### Create deployment directory

```bash
sudo mkdir -p /opt/yt2x
sudo chown $USER /opt/yt2x
cd /opt/yt2x
```

## Step 2: Generate SSH Key for GitHub Actions

### Create a dedicated SSH key

```bash
# Generate a new SSH key pair
ssh-keygen -t ed25519 -C "yt2x-actions" -f ~/.ssh/yt2x_actions -N ""

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/yt2x_actions.pub $USER@YOUR_SERVER_IP

# Test the connection
ssh -i ~/.ssh/yt2x_actions $USER@YOUR_SERVER_IP "echo 'SSH connection successful'"
```

### Get the private key content

```bash
# Display the private key (copy this entire output)
cat ~/.ssh/yt2x_actions
```

The output should look like:
```
-----BEGIN OPENSSH PRIVATE KEY-----
[long base64 string]
-----END OPENSSH PRIVATE KEY-----
```

## Step 3: Set Up GitHub Repository Secrets

Go to your GitHub repository:
1. **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add these secrets:

### Required Secrets

| Secret Name | Value | Example |
|-------------|-------|---------|
| `DEPLOY_HOST` | Your server IP or hostname | `203.0.113.10` or `myserver.com` |
| `DEPLOY_USER` | SSH username | `ubuntu` or `root` |
| `DEPLOY_SSH_KEY` | Full private key content | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

### Optional Secrets

| Secret Name | Value | Example |
|-------------|-------|---------|
| `DEPLOY_PORT` | SSH port (if not 22) | `2222` |

## Step 4: Test Deployment

### Manual Test (Optional)

Before using GitHub Actions, test manually:

```bash
# On your server
cd /opt/yt2x
git clone https://github.com/YOUR_USERNAME/yt2x.git .
cp .env.example .env
# Edit .env with your actual values
nano .env

# Test the build
docker compose up -d --build
docker compose logs -f
```

### GitHub Actions Deployment

1. Push to `main` branch
2. Check **Actions** tab in GitHub
3. Watch the deployment job run

## Step 5: Verify Deployment

### Check service status

```bash
# On your server
cd /opt/yt2x
docker compose ps
docker compose logs --tail=50
```

### Monitor the service

```bash
# Follow logs in real-time
docker compose logs -f

# Check if it's posting to X
# Look for successful identity confirmation and video processing
```

## Troubleshooting

### Common Issues

1. **"missing server host" error**
   - Check that `DEPLOY_HOST` secret is set correctly
   - Verify the secret name matches exactly

2. **SSH connection failed**
   - Ensure the SSH key is copied to the server
   - Test manually: `ssh -i ~/.ssh/yt2x_actions user@host`

3. **Permission denied**
   - Check that the user has access to `/opt/yt2x`
   - Verify Docker group membership

4. **Service not starting**
   - Check Docker logs: `docker compose logs`
   - Verify environment variables in `.env`

### Debug Commands

```bash
# Check Docker status
docker compose ps
docker compose logs

# Check system resources
df -h
free -h

# Check Docker daemon
sudo systemctl status docker
```

## Security Notes

- The SSH key used by GitHub Actions should have minimal permissions
- Consider using a dedicated deployment user with limited sudo access
- Regularly rotate SSH keys
- Monitor server logs for unauthorized access attempts

## Next Steps

After successful deployment:
1. Monitor the service logs for any issues
2. Test with a new YouTube upload
3. Verify X posts include native video
4. Set up monitoring/alerting if needed

## Support

If you encounter issues:
1. Check the GitHub Actions logs
2. Review server logs: `docker compose logs --tail=100`
3. Verify all secrets are set correctly
4. Test SSH connection manually
