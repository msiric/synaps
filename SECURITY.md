# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it via [GitHub Issues](https://github.com/msiric/synaps/issues) with the label `security`.

For sensitive disclosures, email the maintainer directly.

## Scope

synaps is a static analysis tool that runs locally. It:

- **Does NOT** make network requests (except MCP stdio communication with the host process)
- **Does NOT** collect or transmit user data
- **Does NOT** execute user code (AST parsing only, no eval)
- **Does NOT** require elevated permissions

Optional telemetry (`--telemetry` flag) writes tool usage stats to `~/.synaps/telemetry/` locally. No data is transmitted externally.

## Dependencies

This project uses 5 production dependencies. We monitor for vulnerabilities via GitHub Dependabot.
