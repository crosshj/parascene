# Plan: origin story instead of the welcome gate

https://chatgpt.com/share/6aff520d-56c0-83ea-a0f9-fc2b1c936501

Goal: a new account enters the app immediately. Setup is a card in the sidebar footer and one modal per remaining step. Comments and posting stay closed until the step that makes that action possible. No welcome page, no display name, no required character.

Reference: `_docs/DESIGN_origin_story_sidebar.md` and `_docs/origin-story/sidebar-card.png`.

Steps and payouts, once each, stored on the profile so a refresh cannot pay twice:

- Account created, +25, granted at signup
- Username set, +25, granted when the username is saved
- Avatar chosen, +50, granted when an avatar URL is saved
- Total 100

Existing accounts: mark whatever they already have as done. Do not backfill credits.

## Phase 1 — stop the front door

- Remove the welcome redirect and the `WELCOME_REQUIRED` block in `server/routes/middleware/welcomeGate.js`
- `/welcome` sends people home
- Signup lands on `/`
- Google sign-in sits next to email/password. The auth-gate plan already covers the provider work.
- Admins stay ungated

Done when: a brand-new account can open home, feed, and a creation.

## Phase 2 — card and modals

Card in `client/views/Sidebar/SidebarView.html`, above `.sidebar-view__footer-row`. Hidden when all three steps are done. Phone: `1 / 3` on the account control; the card is the top of the account sheet.

Two modals, same dark surface as the card. One step each. No wizard.

- Username modal: `@` prefix, availability, save. This is the only place a new username is collected.
- Avatar modal: upload or generate, preview, save. Optional character text lives here as the generate prompt. It is not its own step and it pays nothing.

Each unfinished step is clickable and opens its modal. The footer button does the same for whichever step is next. Saving closes the modal, fills the next bar segment, and updates the credits count in the footer.

Done when: the card matches the picture, both modals can be finished, and the card disappears at 3 / 3.

## Phase 3 — gates by step

Server rejects the action. The client opens the modal for the missing step instead of failing silently.

- No username: block comments, comment replies, chat sends, and publishing or creating. Browsing, liking, and following stay open.
- Username, no avatar: comments and chat work. Publishing a creation and entering a challenge stay blocked.
- Avatar set: those blocks are gone.

Done when: each blocked action names the missing step, the matching modal finishes it, and a finished account is not blocked.

## Phase 4 — say hello

The Newbies row stays on the home page. Announcing is optional and never blocks the app.

Someone who has not posted an introduction sees one card at the start of the row: “Say hello!” and the 50-credit reward. It opens a short introduction post. Publishing it pays 50 credits once. That card then leaves, and their introduction is the card the community sees. They still see their own introduction in the row.

Done when: the invite shows only before the post, the post pays once, and the community card is that post.

## Phase 5 — greet

Every announced newcomer has a Greet control on their Newbies card until this viewer has greeted them. A greeting pays 10 credits. One viewer can be paid for at most 10 newcomers per day. A viewer is paid only once per newcomer. After that the control shows a greeted state. Past the daily cap, remaining Greet controls stay visible and disabled. Do not show the cap or a progress count. Comments and other replies still work after the cap. The server records each greeting and refuses a second payout.

Done when: the 10-credit payout cannot be claimed twice, and the eleventh greeting in a day pays nothing.

## Later

Per newcomer, cap rewarded greetings. Tentative cap is 10, which is 100 credits. Further greetings stay free. Do not advertise the cap. The greeting record from phase 5 is enough to add this after real use shows the number.

An invite card at the front of Newbies, and any referral credit, stays out of this build.

## Measure

Profile completion. Share of newcomers who announce. Share greeted within 24 hours. Average greetings per newcomer. First creation and first social action. Seven-day retention. Credits paid per new member.

## Order

1, then 2, then 3. The card can ship before the gates. The gates do not ship while `/welcome` is still the front door. 4 and 5 after the row exists. The later items wait.
