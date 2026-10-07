# Security

API keys are stored only in the macOS Keychain (service `claude-switcher`) and are read by the wrapper at launch. They are passed to `security` over stdin when saved, so they do not appear in the process list.

If you find a way this extension could leak a key or credential, please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.
