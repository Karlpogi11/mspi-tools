# Work Permit Autofill — Chrome Extension

## Category

Browser extension (separate from the web tools hosted on `tools.mspi.io`).

## Purpose

Autofills the supported mall Work Permit form, including General Information and Work Details pages.

## User restriction

For approved users using Chrome with a personal email profile only. Do not install or use it with a company-managed/work email profile unless an administrator explicitly approves it.

## Installation

1. Download the extension ZIP from the MSPI Tools page.
2. Extract or unzip the downloaded file.
3. Keep the extracted `workpermit-extension` folder on the local computer. Do not select the ZIP file in Chrome.
4. Open Chrome using the personal-email profile.
5. Open `chrome://extensions`.
6. Enable **Developer mode**.
7. Select **Load unpacked**.
8. Choose the extracted `workpermit-extension` folder—the folder that directly contains `manifest.json`.
9. Pin **Work Permit Autofill** from Chrome’s Extensions menu.
10. Open the supported Work Permit page, review the profile, and select **Fill current page**.

## Updating

Replace the extension folder, open `chrome://extensions`, and select **Reload** on Work Permit Autofill.

## Safety notes

- Review every autofilled value before submitting.
- Dates remain manual by design.
- Use the extension only on the approved Work Permit site.
- The current extension manifest uses broad page access for compatibility. Restrict `host_permissions` and `content_scripts.matches` to the approved domain before wider distribution.
