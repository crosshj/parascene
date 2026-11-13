# Plan: Saved create setups

Set aside. Not current work.

Advanced create keeps a few server setups on the user record. A setup is the only settings memory. The prompt and attached images stay on the open form for the session and are not part of a setup.

## Setup

A setup is the server, the method, and the setting fields on that method: selects, booleans, numbers, colors, and aspect ratio.

Prompt, lyrics, and image or audio inputs are not saved. Typing those does not mark a setup unsaved.

One check decides whether the current form matches a setup and what gets written. A missing field matches that field's default. A stored field the method no longer has is ignored.

## UI

One form group at the top of advanced, above Server. Same label and select as the rest of the form. A star button at the end of the row.

The select lists three slots: Setup 1, Setup 2, Setup 3. It only lists slots. The selected slot is the one advanced opens to, and the one basic and the composer use. That choice is stored with the slots.

The star is filled when the selected slot holds the current settings. An empty star saves into that slot. A filled star clears the slot and leaves the form as it is. A heart already means like on a creation, so this control is a star.

On save, the slot name becomes the model label. A second slot with the same model gets the aspect ratio added. Clearing the slot returns the name to Setup 1, Setup 2, or Setup 3.

The phone uses the system select. The star stays a single tap target. No separate mobile layout.

## Storage

Slots live on `users.meta` under one key. Same read-merge-write as the other account preferences. No new column.

Shape: the active slot id, and three slots of name, server id, method key, and setting values.

## Retire

Stop storing the model, aspect ratio, server, and the composer's separate copies of those. If those keys keep being written, they overwrite the slot the next time a create screen opens.

The session draft still holds the prompt and the images while the form is open.
