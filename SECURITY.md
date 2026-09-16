# Security policy

This kit can ring phones and change PBX settings, so we take reports seriously.

## Reporting

Please **do not open a public issue** for a vulnerability. Use GitHub's private advisory form instead: **Security → Report a vulnerability**. You should get a reply within 5 working days.

## Scope

- The API client, the allowlist and confirmation logic, and the MCP and voice servers are in scope.
- Vulnerabilities in the Grandstream UCM itself should go to Grandstream.

## Hardening checklist for users

- Create a dedicated API user with only the permissions you need, and turn on its IP allowlist.
- Keep `UCM_ALLOW_WRITES` empty unless you need test calls or edits.
- Keep the voice console on `127.0.0.1`, or put it behind your own authentication.
- Disable the deprecated "HTTPS API Settings (Old)" page, or at least change its default credentials.
- Rotate the API password and store it in a secret manager.
