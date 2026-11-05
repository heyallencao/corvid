# Issue #217 overflow evidence

These isolated Electron screenshots show 18 synthetic, long task-history records in the Corvid Agent workbench while the task list is scrolling. The BrowserWindow outer size is set to 704×568; Chromium reports a 719×428 shell viewport. The history and new-conversation controls remain fully visible in both locales.

- zh-CN: `issue-217-workbench-zh-CN-704x568.png`
- en: `issue-217-workbench-en-704x568.png`

The fixture uses a temporary Corvid data directory and the actual isolated default Room/Tab IDs. It does not access a user's browsing data or call a Provider, OAuth, or a model. Coverage is macOS development Electron, light theme, and this window size; webpage WebContentsView is outside the screenshot crop.
