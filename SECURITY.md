# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| < 1.1.0 | :x:                |

## Reporting a Vulnerability

The OmniRoute Monitor team takes the security of our extension and your private credentials seriously.

If you believe you have discovered a vulnerability, security flaw, or potential credential exposure:

1. **Do not disclose the issue publicly.** Do not create public GitHub issues or discussions for security concerns.
2. **Report Privately via GitHub Security Advisories:**
   - Navigate to the repository's **Security** tab.
   - Click on **Advisories** and select **Report a vulnerability**.
3. **Alternative Private Contact:**
   - If GitHub Security Advisories is unavailable, contact the maintainer directly at **wellington.costa@wacsystems.com.br**.
4. **What to Include:**
   - A detailed description of the potential vulnerability.
   - Exact steps or script to reproduce the behavior safely.
   - Potential impact and affected versions.
   - Any proposed remediations or patches if available.

### Our Commitment
- We will acknowledge receipt of your vulnerability report within 48 hours.
- We will provide a status update on triage and planned fixes within 5 business days.
- We will credit you in the release notes and advisory upon mutual agreement once the patch is published.

---

## Security Principles in OmniRoute Monitor

- **Local Storage Only:** OmniRoute tokens, passwords, and SSH keys are stored exclusively in OpenChamber's local guest storage on your machine.
- **No Cloud Reporting:** The extension contains zero tracking scripts, remote logging, or analytics.
- **Sandboxed Execution:** UI rendering is restricted to an isolated iframe. Host operations are mediated by a minimal Node.js service binding strictly to `127.0.0.1`.
