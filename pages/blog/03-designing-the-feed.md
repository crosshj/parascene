---
title: "Designing the Feed: Serendipity vs. Control"
description: "How we design the Parascene feed so it feels surprising without feeling random, and why we avoid simple 'most liked' rankings."
date: "2026-03-11"
---

Feeds are quietly opinionated.

Even when you never expose a single knob, your ranking logic decides:

- Whose work gets seen  
- What styles are rewarded  
- How fast the meta shifts — or freezes

In Parascene, those choices are amplified because every scroll isn’t just a post; it’s a *prompt* for what someone might make next.

## 1. Why we don’t default to “most liked”

The obvious first feed for any creative network is:

> Sort everything by likes and call it a day.

We tried variants of that early on, and saw predictable problems:

- **Rich get richer**: early hits dominate for a long time, making it hard for newer creators to surface.  
- **Style collapse**: once a visual style proves effective, more and more people chase it, tightening the loop.  
- **Risk aversion**: ambitious, weird, or in‑progress work performs worse, so the feed nudges people away from experimentation.

We’re not philosophically against popularity. We just don’t want it to be the *only* organizing principle.

## 2. The levers we actually use

Today’s feed tries to balance:

- **Recency**: fresh work should have a shot before we know how it performs.  
- **Engagement**: likes, comments, saves, click‑throughs, and completion signals still matter.  
- **Diversity**: we actively prefer not to show you 10 near‑identical images in a row.  
- **Context**: where you are (server vs. global), who you follow, and what you’ve interacted with recently.

We experiment with different blends, but the principle is consistent:

- Enough **predictability** that the feed feels coherent  
- Enough **entropy** that you see things you wouldn’t have typed into a search box

## 3. Protecting room for “small” work

One quiet design constraint is to keep space for:

- Sketches  
- Studies  
- Odd experiments that don’t “land” with a wide audience

If the feed only pushed polished bangers, we’d be building a gallery, not a tool for making things.

We try to protect:

- **Local surfaces** (e.g., within a server or your own profile) where small work can live without needing huge numbers.  
- Occasional **feed slots** explicitly set aside for things that are newer or less‑engaged but locally relevant.  
- Ranking curves that don’t drop a piece to zero just because it didn’t explode in the first few minutes.

This matters more than it looks on paper; those small pieces are often where a creator’s real voice develops.

## 4. Serendipity without chaos

The hardest part is making surprise feel intentional rather than random.

Some of the tricks we use:

- **Micro‑clusters**: we group related content (by creator, theme, or behavior) and then pick from those clusters rather than from the full firehose.  
- **Session memory**: we track what you’ve already seen in this browsing session so we don’t keep throwing the same thing at you.  
- **Soft pivots**: after a run of similar content, we bias toward something slightly different rather than more of the same.

When this works, you get:

- A few posts that feel like exactly what you came for  
- A few that are adjacent to your tastes  
- A few that are weird in an interesting way

## 5. Things we still get wrong

We’re not done. Some known issues:

- **Cold start**: new users and new creators are still hard to place quickly and well.  
- **Niche collapse**: when you’re into something very specific, it’s easy for the feed to oscillate between “too narrow” and “way off.”  
- **Feedback opacity**: it’s not always clear *why* something shows up, which makes it harder for creators to learn.

We’re experimenting with:

- Better **per‑server and per‑context feeds** instead of one mega‑logic.  
- Lightweight **explanations** like “Because you follow X” or “Trending in this server” where it doesn’t clutter the UI.  
- More explicit **spaces for work‑in‑progress**, where the goal isn’t engagement at all, just learning and feedback.

If you’re using Parascene today, you’re already training these systems whether you mean to or not. Part of this blog’s job is to keep that relationship visible and understandable.

