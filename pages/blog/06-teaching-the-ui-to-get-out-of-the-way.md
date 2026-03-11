---
title: "Teaching the UI to Get Out of the Way"
description: "How the Parascene interface evolved from a wall of controls to a layered experience that lets you start simple and go deep when you’re ready."
date: "2026-03-11"
---

The easiest way to build a “powerful” creative tool is to:

- Expose every knob  
- Put them all on screen at once  
- Call it a day

We did a bit of that at first. It worked for a tiny group of early power users and almost nobody else.

This post walks through how we’ve been teaching the UI to *get out of the way* without dumbing the tool down.

## 1. The early wall of sliders

When we first wired up more advanced controls, the create page looked like:

- Prompt field  
- Model selector  
- Resolution, steps, guidance, seeds  
- A handful of specialist toggles

You could:

- Dial in very specific looks  
- Reproduce runs with high fidelity  
- Break things in spectacular ways

But we saw patterns:

- New users froze or left the page.  
- People who *could* use the controls still spent more time tweaking than creating.  
- Many sliders ended up in a small set of “known good” positions anyway.

The interface had become a control panel for us, not an instrument for you.

## 2. Progressive disclosure as a default

The design principle we moved toward is:

> Start with the smallest useful surface. Reveal complexity only after someone asks for it.

Practically, that means:

- **Default view**: prompt, a focused set of style or intent choices, and a clear “go” button.  
- **Advanced view**: reachable, but not in your face — tucked under an “advanced” or “fine‑tune” section.  
- **Memory**: when a user consistently uses advanced controls, we remember and surface them sooner.

This preserves:

- A low‑friction first experience  
- A real path to mastery

## 3. Naming things in human language

Models and parameters ship with names like:

- `cfg_scale`  
- `sampler_steps`  
- `strength`

Those mean something to people who read model docs, but not to:

- A photographer thinking in terms of lighting and composition  
- A hobbyist who just wants “more like this, but moodier”

We’ve been gradually:

- **Renaming controls** into more descriptive language.  
- Adding **inline hints** like “Higher = closer to your prompt, lower = looser, more surprising.”  
- Hiding internal details that don’t offer clear creative leverage.

The goal isn’t to hide the math — it’s to make the interface speak in terms of *intent* rather than implementation.

## 4. Respecting flow and failure

Good UIs make it cheap to:

- Try something  
- See that it doesn’t work  
- Try again

In Parascene, that translates into:

- Fast, visible **history**: you can see and branch from recent attempts.  
- Low‑friction **tweaks**: change one thing, not fifteen, between runs.  
- Clear **error states**: when something fails, the UI says what happened and what you can try next.

Every time we add a control, we ask:

- Does this make it easier to *recover* from a bad generation?  
- Or does it just increase the number of ways to get stuck?

If the answer is the latter, it’s a candidate for either removal or hiding behind an advanced affordance.

## 5. What’s next for the UI

There are a few directions we’re exploring:

- **Contextual presets**: instead of generic styles, presets tuned to the kind of thing you’re making (portraits, abstract art, UI mocks, etc.).  
- **Inline education**: tiny, skimmable explanations or examples wired directly into controls, not buried in docs.  
- **Server‑aware defaults**: letting servers specify sane defaults for their context while still respecting personal preferences.

All of this should push toward the same feeling:

- You’re playing with an instrument that responds to you  
- Not operating a dashboard on behalf of a model

When we get it right, the UI fades and the only thing that feels real is the work in front of you. That’s the bar we’re aiming for.

