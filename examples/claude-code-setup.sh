#!/bin/bash

# Setup script for hangpay with Claude Code
# This script initializes the vault and configures the MCP server.

set -e

echo "--- Initializing hangpay Vault ---"
# This will prompt for card details and encrypt them
npx pop-init-vault

echo ""
echo "--- Launching Chrome with CDP ---"
# Launches Chrome with remote debugging enabled on port 9222
# The --print-mcp flag shows the commands for different platforms
npx pop-launch --print-mcp &

# Wait a moment for Chrome to start
sleep 3

echo ""
echo "--- Adding MCP Server to Claude Code ---"
# Adds hangpay as a global MCP server for Claude Code
claude mcp add hangpay --scope user -- npx hangpay launch-mcp

echo ""
echo "Setup Complete!"
echo "You can now ask Claude Code to make purchases within your configured policy."
echo "Check ~/.config/hangpay/.env to configure spending limits."

