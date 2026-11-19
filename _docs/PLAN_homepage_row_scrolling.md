# Plan: Homepage row scrolling

Desktop homepage only. Add previous/next controls to the horizontal rails. Leave the cards, their size, order, links, and interactions as they are. No mobile layout, no other pages.

Today each desktop section is a heading plus one `.home-row` in `client/views/Home/HomeView.js`. The row is the only horizontal scroller. Mobile home mounts the feed and is out of scope.

## Controls

Heading stays on the left. On the right, a compact previous/next pair, then the existing section link when that section has one. Same alignment and spacing on every rail.

Buttons are small rounded squares: subtle dark fill, thin border, muted chevron. Quiet hover and active. Disabled arrows are dimmed, not removed, so the header does not jump. Hide the whole pair when the row does not overflow.

No arrows on the cards. No dots, counters, progress, or custom scrollbar. No glow, heavy shadow, or gradient.

## Behavior

Next moves about one visible width and keeps roughly one card in view. Previous uses the same distance backward. Land on a card edge. The last step shows the last card without a big empty gap. Do not wrap.

Measure from the cards that are actually in the row: their positions, widths, the gap, and the row width. Do not use a fixed pixel step or `scrollBy` of the row width. Widths differ across images, challenges, and articles.

Smooth scroll. If the user prefers reduced motion, jump. Previous is disabled at the start, next at the end. Compare edges with a few pixels of tolerance.

Trackpad and other native horizontal scrolling stay. Button state follows the real scroll position, including a manual scroll. One row never moves another. Vertical page scrolling stays native. No global wheel capture.

Empty, single, and fully visible rows show no arrows. A row that overflows by only a few pixels does. Resizing, late images, and cards added or removed update the arrows and do not jump the scroll back to the start. Repeated clicks do not fight each other or the user's scroll.

## Build

One shared behavior for every `.home-row`. Extend the desktop home section. Do not make a second scroller, a new card, or a new route. Do not change where a section link goes.

Keep four jobs separate: the section header, the buttons, the row and its scroll math, the existing tiles.

Listen for scroll and size changes, including image load. Disconnect those listeners when a section is replaced or the page unmounts. Do not rerender the row on every scroll frame, and do not answer a scroll event by scrolling again.

Buttons are real buttons, labeled Previous and Next, keyboard reachable, with a visible focus ring and enough contrast.

## Done

- Every overflowing desktop rail has the same header controls.
- Arrows are hidden when nothing overflows, and disabled at each end.
- A click moves about one view, aligned to a card, with a little overlap.
- Manual scrolling still works, and the arrows follow it.
- Rails stay independent through resize and new cards.
- Cards and the section links are unchanged.
- Mobile is unchanged.
