#!/bin/bash

echo "🎯 YouTube Cookies Setup for yt2x"
echo "=================================="
echo ""
echo "This script will help you set up YouTube cookies to bypass restrictions."
echo ""

# Check if cookies directory exists
if [ ! -d "cookies" ]; then
    echo "❌ Cookies directory not found. Please run this from the yt2x root directory."
    exit 1
fi

echo "📋 Steps to export cookies:"
echo ""
echo "1. Install a 'cookies.txt' extension in your browser:"
echo "   - Chrome/Brave: Search for 'Get cookies.txt' extension"
echo "   - Firefox: Search for 'cookies.txt' extension"
echo ""
echo "2. Log into YouTube in your browser"
echo ""
echo "3. Use the extension to export cookies to:"
echo "   $(pwd)/cookies/youtube.txt"
echo ""
echo "4. Restart the container:"
echo "   docker compose up -d --build"
echo ""

# Check if cookies file already exists
if [ -f "cookies/youtube.txt" ]; then
    echo "✅ Cookies file found at cookies/youtube.txt"
    echo "   File size: $(wc -c < cookies/youtube.txt) bytes"
    echo "   Last modified: $(stat -f "%Sm" cookies/youtube.txt)"
    echo ""
    echo "You can now restart the container to use these cookies."
else
    echo "❌ No cookies file found at cookies/youtube.txt"
    echo "   Please follow the steps above to export cookies from your browser."
fi

echo ""
echo "💡 Tip: Cookies expire periodically, so you may need to re-export them"
echo "   if downloads start failing again."
