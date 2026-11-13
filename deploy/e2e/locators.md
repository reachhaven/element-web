<!--
SPDX-FileCopyrightText: 2026 vDL Digital Ventures

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
-->

# Names the suite relies on

The app is a React DOM with ARIA roles. The suite finds what it can by role and accessible name, the English strings of
`apps/web/src/i18n/strings/en_EN.json` and `packages/shared-components/src/i18n/strings/en_EN.json` with the browser in
`en-US`, checked against accessibility snapshots of the image at 1280x800. Names marked (MAS) are the account
provider's; names marked (upload-caption) and (gif-picker) come from the fork's branches `feat/upload-caption` and
`feat/gif-picker`, which `staging/web` carries.

A production build has fewer `data-testid` attributes than upstream's Playwright suite sees: when webpack minifies, it
runs `babel-plugin-jsx-remove-data-test-id` over `apps/web`, so only the test ids of `packages/shared-components` stay.
The suite uses those (`event-tile`, `event-tile-slot-*`, `toast-buttons`) and three selectors that upstream's suite uses
too: `header.mx_RoomHeader` for the room header, `.mx_RoomView_body` for the room's timeline and composer (as opposed
to the thread's in the right panel), and `#mx_RightPanel`. Some strings carry the app's name (`%(brand)s`); the suite
never matches that part.

## Sign-in and recovery

| Screen                     | Role                | Name                                                                                                                                                                                              |
| -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start                      | none                | `sso_redirect_options.immediate` sends the browser to the account provider before anything renders                                                                                                |
| MAS consent (`/consent/…`) | button              | `Continue` (MAS)                                                                                                                                                                                  |
| MAS sign-in, no module     | textbox             | `Username`, `Password`; button `Continue` (MAS)                                                                                                                                                   |
| Signed in                  | button              | `User menu` (top left); its menu has menuitem `All settings`                                                                                                                                      |
| A later device             | heading             | `Confirm your digital identity`; buttons `Use another device`, `Use recovery key` (disabled without one), `Can't confirm?`, `Sign out`                                                            |
| Recovery key entry         | dialog with heading | `Enter your recovery key`; a password field with the placeholder `Recovery key`; button `Continue`, enabled once the key is valid                                                                 |
| Device verified            | text                | starts with `Your new device is now verified`; button `Done`                                                                                                                                      |
| Identity reset             | button              | `Can't confirm?`, then the dialog's `Continue` and `Continue to account`, which opens the account provider in a popup with button `Finish reset` and heading `Identity reset successfully…` (MAS) |
| Settings                   | dialog              | `Settings: <tab>`; tabs `Account`, …, `Encryption`; button `Close dialog`                                                                                                                         |
| Encryption tab             | switch              | `Allow key storage`, on for a new account                                                                                                                                                         |
| Encryption tab             | button              | `Create recovery key`, or `Change recovery key` once there is one                                                                                                                                 |
| New recovery key           | text                | `Save your recovery key somewhere safe`, the key as text (the suite blurs `.mx_KeyPanel_key` for the recordings); buttons `Copy` (puts the key on the clipboard), `Continue`                      |
| Key confirmation           | text                | `Enter your recovery key to confirm`; one textbox; button `Finish set up`; then the text `Backup is now fully set up`                                                                             |
| Wrong key                  | text                | `The recovery key you entered is not correct.`; the dialog's `Continue` stays disabled, `Cancel` closes it                                                                                        |
| Sign out                   | button              | `Remove this device` in Settings; the confirmation dialog's heading says `remove this device` or `removing this device`, its button is `Remove this device` or `Continue to remove this device`   |

## Things that come up by themselves

Toasts are alerts with `data-testid="toast-buttons"` around their buttons; the suite dismisses these whenever they are
in the way.

| What                                     | Role               | Name                                    | The suite clicks |
| ---------------------------------------- | ------------------ | --------------------------------------- | ---------------- |
| Notifications                            | alert with heading | `Notifications` or `Don't miss a reply` | `Dismiss`        |
| Recovery reminder                        | alert with heading | `Back up your chats`                    | `Not now`        |
| Devices of earlier runs                  | alert with heading | `You have unverified devices`           | `Later`          |
| Release announcement on the `New` button | dialog             | contains `Introducing Sections`         | `Ok`             |

## Spaces and the room list

| Where                  | Role                   | Name                                                                                                                                                                                         |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space panel            | navigation with tree   | `Spaces`; buttons named after the spaces, and `Home`                                                                                                                                         |
| Space context menu     | menuitem               | `Space home`, `Settings`, …; the settings are dialog `Settings - <space>` with textbox `Name` and button `Save Changes`, which stays enabled; `Cancel` turns disabled once the name is saved |
| Room list              | navigation             | `Room list`; the header is labelled `Room options` and holds button `New` with menuitems `Start chat` and `New room` (the latter only where one may add rooms)                               |
| Room list sections     | treegrid with gridcell | `Room list`; sections such as `Toggle Invites section…`, with `aria-expanded`; the invitations are folded away at first                                                                      |
| Room in the list       | button                 | `Open room <name>`, `Open room <name> with <count> unread message(s).`, `Open room <name> invitation.`; a direct chat is named after the other person                                        |
| Search (Ctrl+K)        | dialog                 | `Search Dialog`, textbox `Search`, results are options named after the rooms                                                                                                                 |
| New room               | dialog                 | textbox `Name`; button `Create room`; with a space selected the room goes into it                                                                                                            |
| Invitation or new chat | dialog                 | `Invite to <room>` or `Direct Messages`; textbox `Search`; listbox `Suggestions` with options named after the people, their Matrix ID in the text; buttons `Invite` or `Go`                  |
| First contact          | dialog with heading    | `Invite new contacts to this chat?` (button `Invite`) or `Start a chat with this new contact?` (button `Continue`)                                                                           |
| Invitation preview     | button                 | `Accept` for a room, `Start chatting` for a direct chat                                                                                                                                      |

## Room

| Where                      | Role                 | Name                                                                                                                                                   |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header                     | heading (level 1)    | the room name; buttons `Video call`, `Voice call`, `Threads`, `Room info`                                                                              |
| Right panel                | `#mx_RightPanel`     | button `Close`                                                                                                                                         |
| Room info                  | menuitem             | `Invite`, `People`, `Threads`, `Settings`, …; the badge text `Encrypted`; a search field with the placeholder `Search messages…`; the topic            |
| Room settings              | dialog               | `Room Settings - <name>`; textboxes `Room Name`, `Room Topic`; button `Save`, disabled again once saved                                                |
| Timeline                   | listitem             | each event, with `data-testid="event-tile"` and the slots `event-tile-slot-body`, `-replyChain` and `-threadInfo`                                      |
| Newer messages below       | button               | `Scroll to most recent messages`; while the timeline is scrolled up, Element does not render the newest events                                         |
| Message actions (on hover) | toolbar              | `Message actions`: `React`, `Reply`, `Reply in thread`, `Options`, and `Pin` and `Edit` on text messages; `Hide` and `Download` on media               |
| Reaction picker            | toolbar              | `Quick Reactions`, with checkboxes named after the emoji, variation selector included (`👍️`)                                                           |
| Reactions                  | toolbar with buttons | `Reactions`; `<names> reacted with <emoji>`; a click on one's own takes it back                                                                        |
| Read receipts              | group                | `Seen by <count> person` or `… people`, with a button named after the readers                                                                          |
| Image                      | link with img        | the caption, or the file name without one                                                                                                              |
| Video                      | video                | native controls; the play control sits at the bottom left                                                                                              |
| Image viewer               | dialog               | `Image view`, with the image named like the one in the timeline and button `Close`                                                                     |
| Code block                 | button               | `Copy` next to the block; then the text `Copied!`                                                                                                      |
| Pinned messages            | region               | `Pinned messages`, holding the pinned text                                                                                                             |
| Poll                       | group with radios    | `Poll <question>`; radios `Option <n>, <answer>, <count> votes`; `Based on 1 vote` after one's own vote, `1 vote cast. Vote to see the results` before |
| Search results             | text                 | `<count> results found for “<query>”`, and `This version of <app> does not support searching encrypted messages`; button `Cancel`                      |
| Name and topic changes     | text                 | `<name> changed the topic to "<topic>".`                                                                                                               |

## Composer

| Where               | Role     | Name                                                                                                                                    |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Composer area       | region   | `Message composer`, the room's in `.mx_RoomView_body` and the thread's in the right panel                                               |
| Rich text composer  | textbox  | `Message composer`, a `contenteditable` element                                                                                         |
| Formatting bar      | button   | `Bold`, `Italic`, `Underline`, `Strikethrough`, `Bulleted list`, `Numbered list`, `Quote`, `Code`, `Code block`, `Link`                 |
| Composer buttons    | button   | `Emoji`, `Hide formatting`, `Attachment`, `More options`; `Send message` once there is text; `GIF` (gif-picker) when the configuration sets `gif_provider` |
| Keyboard            | keys     | Ctrl+B bold, Ctrl+I italic, Ctrl+U underline, Ctrl+E inline code, Ctrl+Alt+C code block (Ctrl+Shift+C on macOS; feat/composer-code-block-shortcut), Enter sends, Shift+Enter starts a new line |
| More options        | menuitem | `Poll`, `Sticker`, `Voice Message`, `Location`                                                                                          |
| Upload              | dialog   | textbox `Caption (optional)` (upload-caption); button `Upload`                                                                          |
| Mention suggestions | option   | inside the composer area, named after the people, their Matrix ID in the text, after `@` and the first letters                          |
| Poll                | dialog   | `Create poll`; textboxes `Question or topic`, `Option 1`, `Option 2`; button `Create Poll`                                              |
| GIF search          | region   | `GIF picker`, searchbox `Search GIFs`, the GIFs are buttons named after their titles (gif-picker)                                       |

## Behaviour the flows depend on

- Element leaves its own origin before it renders anything: with `sso_redirect_options.immediate` it registers at the
  account provider and sends the browser there. The suite waits for that and hands the page to the login module. When
  the provider still knows the person (the second sign-in in flow 9) it goes straight to its consent page, which the
  suite accepts itself.
- A new account lands on Home with no prompt: Element creates the cross-signing keys and turns key storage on by
  itself, so only the recovery key is missing. The suite creates it in Settings, Encryption, copies it with `Copy`, takes
  it from the clipboard and keeps it in `.recovery-keys.json`.
- Every later device of the same person stops at `Confirm your digital identity` before the app shows anything else.
  With a stored key the suite takes `Use recovery key`; the history then comes back from key storage. Without one, and
  with `E2E_ALLOW_IDENTITY_RESET=1`, it resets the identity through `Can't confirm?` and the account provider and creates
  a new recovery key.
- The message actions appear only while the pointer is over a message, so the suite hovers first.
- An encrypted video starts with an empty source and its thumbnail: the first press of play fetches and decrypts it,
  and it may stay paused until play is pressed again.
- Element cannot edit an image's caption: `Edit` is offered for text messages and polls only.
- Element on the web cannot search encrypted rooms and says so above zero results; the suite then checks that the room
  can be found by name instead. Zero results without that notice fail the step.
- Starting a direct chat with someone one has a direct chat with already opens that chat, so the other person gets no
  invitation; the suite then opens the existing chat on the other side too.
