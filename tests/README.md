# Playwright Testing Setup

This project now includes Playwright for end-to-end testing and is configured to work with Claude Desktop's MCP (Model Context Protocol) for enhanced browser automation capabilities.

## What's Installed

1. **Playwright MCP Server**: Globally installed to provide browser automation capabilities to Claude Desktop
2. **@playwright/test**: Project dependency for running Playwright tests
3. **Browser binaries**: Chromium, Firefox, and WebKit browsers for testing

## Configuration

### Claude Desktop MCP Configuration

The Playwright MCP server has been added to your Claude Desktop configuration at:
`~/Library/Application Support/Claude/config.json`

You'll need to restart Claude Desktop for the MCP server to be available.

### Project Configuration

- `playwright.config.ts`: Main Playwright configuration
- `tests/e2e/`: Directory for end-to-end tests
- Test scripts added to `package.json`

## Available Scripts

```bash
# Run all Playwright tests
pnpm test:e2e

# Run tests with UI mode (interactive)
pnpm test:e2e:ui

# Run tests in headed mode (visible browser)
pnpm test:e2e:headed

# Run tests in debug mode
pnpm test:e2e:debug
```

## Usage with Claude Desktop

Once you restart Claude Desktop, you'll have access to browser automation capabilities through the Playwright MCP server. This allows Claude to:

- Navigate web pages
- Interact with elements (click, type, etc.)
- Take screenshots
- Extract content
- Run automated tests
- And much more!

## Example Test

The project includes a basic homepage test in `tests/e2e/homepage.spec.ts` that you can modify based on your application's actual content and functionality.

## Next Steps

1. **Restart Claude Desktop** to enable the MCP server
2. **Customize the example test** to match your application
3. **Add more test files** as your application grows
4. **Run the tests** to ensure everything works correctly

## Troubleshooting

If you encounter issues:

1. Make sure Claude Desktop has been restarted
2. Check that the MCP server is properly configured in the Claude config
3. Ensure your development server is running when tests execute
4. Verify browser binaries are installed: `pnpm exec playwright install`
