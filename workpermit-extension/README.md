# Work Permit Autofill — Chrome Extension

Standalone Chrome extension for autofilling the supported mall Work Permit form.

This is separate from the web tools hosted on `tools.mspi.io`.

## User restriction

This extension is intended for approved users running Chrome with a personal email profile. It must not be installed or used under a company-managed/work email profile unless explicitly approved by an administrator.

The extension does not provide account management or server-side access control. Distribution should be limited to approved users, and the extension folder should be obtained from the official project source.

## Installation in Chrome

1. Download the extension ZIP from the MSPI Tools page.
2. Extract or unzip the downloaded file.
3. Keep the extracted `workpermit-extension` folder on your computer. Do not select the ZIP file in Chrome.
4. Open Chrome using your personal-email profile.
5. Visit `chrome://extensions`.
6. Enable **Developer mode**.
7. Click **Load unpacked**.
8. Select the extracted `workpermit-extension` folder—the folder that directly contains `manifest.json`.
9. Pin **Work Permit Autofill** from the Extensions menu.
10. Open the supported Work Permit form, click the extension icon, enter or review the profile, and choose **Fill current page**.

## Updating

1. Replace the local extension folder with the newer approved version.
2. Open `chrome://extensions`.
3. Find **Work Permit Autofill** and click **Reload**.

## Important notes

- Keep the extension folder; Chrome loads it directly from that location.
- Review autofilled values before submitting a permit.
- Dates remain manual by design.
- Do not use the extension on unrelated websites.
- The current manifest uses broad page access for compatibility. Restrict `host_permissions` and `content_scripts.matches` to the approved Work Permit domain before wider distribution.
