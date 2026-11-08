# Command palette — remaining work

The command palette is available across the app with `Cmd/Ctrl+K` on desktop. Mobile access is still open: `open()` in `client/shared/commandPalette/commandPalette.js` deliberately returns at mobile widths, and the chat header has no search/jump control.

## Open

- [ ] Add a visible search/jump button to the mobile chat header that opens the existing command palette. Keep the control in the chat header, use the app's standard icon/button treatment, and provide an accessible name.
- [ ] Keep the desktop shortcut behavior unchanged. Verify the mobile control opens the palette and supports search, selection, close, and focus behavior at narrow viewport sizes.

The prefix filters, server discovery/join flows, command actions, recents, and other polish ideas from the earlier draft are not committed work and are intentionally omitted from this remaining-work list.
