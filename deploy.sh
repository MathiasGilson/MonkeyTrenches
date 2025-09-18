#!/bin/bash

# MonkeyPlanet GitHub Pages Deployment Script
# This script builds the webapp locally and deploys it to GitHub Pages

set -e  # Exit on any error

echo "🚀 Starting MonkeyPlanet deployment to GitHub Pages..."

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ Error: This directory is not a git repository"
    exit 1
fi

# Check if we have uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "⚠️  Warning: You have uncommitted changes. Consider committing them first."
    read -p "Do you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled."
        exit 1
    fi
fi

# Store current branch
CURRENT_BRANCH=$(git branch --show-current)
echo "📋 Current branch: $CURRENT_BRANCH"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build the application
echo "🔨 Building the application..."
NODE_ENV=production npm run build

# Check if build was successful
if [ ! -d "dist" ]; then
    echo "❌ Error: Build failed - dist directory not found"
    exit 1
fi

# Create or switch to gh-pages branch
echo "🌿 Setting up gh-pages branch..."
if git show-ref --verify --quiet refs/heads/gh-pages; then
    echo "Switching to existing gh-pages branch..."
    git checkout gh-pages
else
    echo "Creating new gh-pages branch..."
    git checkout --orphan gh-pages
fi

# Remove all files except dist and .git
echo "🧹 Cleaning gh-pages branch..."
find . -maxdepth 1 ! -name '.git' ! -name 'dist' ! -name '.' -exec rm -rf {} + 2>/dev/null || true

# Move dist contents to root
echo "📁 Moving build files to root..."
if [ -d "dist" ]; then
    mv dist/* . 2>/dev/null || true
    mv dist/.* . 2>/dev/null || true
    rmdir dist 2>/dev/null || true
fi

# Create .nojekyll file to bypass Jekyll processing
touch .nojekyll

# Add and commit all files
echo "💾 Committing changes..."
git add .
if git diff --staged --quiet; then
    echo "⚠️  No changes to commit"
else
    git commit -m "Deploy MonkeyPlanet to GitHub Pages - $(date)"
fi

# Push to GitHub Pages
echo "🚀 Pushing to GitHub Pages..."
git push origin gh-pages --force

# Return to original branch
echo "🔄 Returning to $CURRENT_BRANCH branch..."
git checkout "$CURRENT_BRANCH"

echo "✅ Deployment complete!"
echo "🌐 Your site should be available at: https://$(git config --get remote.origin.url | sed 's/.*github.com[:/]\([^/]*\)\/\([^.]*\).*/\1.github.io\/\2/')"
echo "⏰ Note: It may take a few minutes for GitHub Pages to update."
