# MonkeyTrenches Deployment Guide

This guide explains how to deploy the MonkeyTrenches webapp to GitHub Pages.

## Prerequisites

1. **GitHub Repository**: Ensure your project is pushed to a GitHub repository
2. **Node.js**: Make sure Node.js and npm are installed locally
3. **Git**: Git should be configured with your GitHub credentials

## Deployment Methods

### Method 1: Automatic Deployment (Recommended)

The project is configured with GitHub Actions for automatic deployment:

1. **Push to main branch**: Any push to the `main` branch will automatically trigger deployment
2. **GitHub Pages setup**: 
   - Go to your repository settings on GitHub
   - Navigate to "Pages" section
   - Set Source to "GitHub Actions"
   - The site will be available at: `https://mathiasgilson.github.io/MonkeyTrenches/`

### Method 2: Manual Local Deployment

Use the provided deployment script for manual deployment:

```bash
# Quick deployment
npm run deploy

# Or run the script directly
./deploy.sh
```

The script will:
- Build the application with production settings
- Create/switch to `gh-pages` branch
- Copy build files to the branch root
- Push to GitHub Pages
- Return to your original branch

## Configuration Details

### Vite Configuration

The `vite.config.ts` is configured for GitHub Pages:
- **Base path**: Set to `/MonkeyTrenches/` in production
- **Build output**: Generated in `dist/` directory
- **Source maps**: Enabled for debugging

### GitHub Actions Workflow

Located at `.github/workflows/deploy.yml`:
- **Trigger**: Runs on push to main branch
- **Node.js**: Uses Node.js 18
- **Build**: Runs `npm ci` and `npm run build`
- **Deploy**: Uses official GitHub Pages actions

## Troubleshooting

### Common Issues

1. **Build Failures**
   ```bash
   # Check for TypeScript errors
   npm run lint
   
   # Test build locally
   npm run build
   npm run preview
   ```

2. **GitHub Pages Not Updating**
   - Check the Actions tab for failed deployments
   - Ensure GitHub Pages is enabled in repository settings
   - Wait a few minutes as updates may take time

3. **Asset Loading Issues**
   - Verify the base path in `vite.config.ts` matches your repository name
   - Check that all assets use relative paths

### Manual Cleanup

If you need to reset the deployment:

```bash
# Clear any local build artifacts
rm -rf dist
npm run build

# Force push to trigger new deployment
git push origin main --force
```

## Development Workflow

1. **Local Development**: `npm run dev`
2. **Build Testing**: `npm run build && npm run preview`
3. **Deploy**: `npm run deploy` or push to main for automatic deployment

## Environment Variables

- `NODE_ENV=production`: Set automatically during build for proper asset paths
- No additional environment variables required for basic deployment

## Security Notes

- The deployment script uses `--force` push to gh-pages branch
- Always commit your changes before deploying
- The script will warn about uncommitted changes

---

For more information about GitHub Pages, visit the [official documentation](https://docs.github.com/en/pages).
