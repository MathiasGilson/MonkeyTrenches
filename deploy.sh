#!/bin/bash

# MonkeyTrenches GitHub Pages Deployment Script
# This script builds the webapp locally and pushes to main branch for GitHub Actions deployment

set -e  # Exit on any error

echo "🚀 Starting MonkeyTrenches deployment to GitHub Pages..."

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ Error: This directory is not a git repository"
    exit 1
fi

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "⚠️  Warning: You're not on the main branch (currently on $CURRENT_BRANCH)"
    read -p "Do you want to switch to main branch? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git checkout main
    else
        echo "Deployment cancelled."
        exit 1
    fi
fi

# Check if we have uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "⚠️  Warning: You have uncommitted changes."
    echo "Please commit or stash your changes before deploying."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build the application locally to test
echo "🔨 Testing build locally..."
NODE_ENV=production npm run build

# Check if build was successful
if [ ! -d "dist" ]; then
    echo "❌ Error: Build failed - dist directory not found"
    exit 1
fi

echo "✅ Build successful!"

# Clean up local build (GitHub Actions will build again)
rm -rf dist

# Push to main branch to trigger GitHub Actions
echo "🚀 Pushing to main branch..."
git push origin main

echo "✅ Deployment initiated!"
echo "🌐 GitHub Actions will build and deploy your site."
echo "🌐 Your site will be available at: https://mathiasgilson.github.io/MonkeyTrenches/"
echo "⏰ Check the Actions tab in your repository to monitor deployment progress."
echo "⏰ Note: It may take a few minutes for GitHub Pages to update."
