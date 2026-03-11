---
title: "Moderation When the Model Is the Brush"
description: "What content safety means in a world where the 'brush' is a generative model, and how Parascene tries to keep things safe without killing experimentation."
date: "2026-03-11"
---

Moderation in Parascene is different from moderation in a traditional social network.

On a normal platform:

- Users upload content they made elsewhere  
- Moderation looks at what’s already fixed on disk

On Parascene:

- Users describe what they want  
- A model does its best to generate something that matches  
- Sometimes the result violates rules neither we nor the user intended to cross

## 1. Three layers of safety

We think in three layers:

1. **Policy** — what’s allowed in principle, and what’s never allowed  
2. **Tooling** — classifiers, filters, and workflows that enforce policy at scale  
3. **UX** — how all of that actually feels as you use the product

If any one of those layers is misaligned, things go wrong:

- Policy too vague → chaos and inconsistent enforcement  
- Tooling too brittle → over‑blocking or under‑blocking in ways that feel arbitrary  
- UX too opaque → people feel punished by a system they don’t understand

Our job is to tune all three at once, which is harder than just “add a filter.”

## 2. When the model surprises everyone

Sometimes:

- The prompt seems fine  
- The user’s intent is clearly benign  
- The output still crosses a line (or sits right on it)

We try to handle those cases with:

- **Generation‑time checks**: if a classifier is confident that an output breaks policy, we stop it before it leaves the worker.  
- **Stronger review around edge prompts**: certain categories of prompts always get more scrutiny.  
- **User‑level feedback**: wherever possible, we tell you *why* something was blocked and how to adjust.

The hard part is avoiding the feeling of “I’m fighting the system” when you’re genuinely trying to do something interesting and legitimate.

## 3. Over‑blocking vs. under‑blocking

There’s no perfect line here.

If we:

- **Over‑block**, we:
	- Stifle experimentation  
	- Frustrate good‑faith users  
	- Turn the platform into a puzzle game about dodging filters
- **Under‑block**, we:
	- Take on real legal and ethical risk  
	- Make the space feel unsafe or unwelcoming  
	- Invite misuse that’s hard to roll back once it takes hold

We intentionally bias differently in different contexts:

- Public, discoverable surfaces are **stricter**.  
- Private or semi‑private spaces may be **more flexible**, within global policy.  
- Some model capabilities are **gated** to users or servers that meet additional criteria.

## 4. Community norms still matter

Automated systems can’t do everything.

Servers and smaller communities can:

- Set **stricter norms** than the global baseline  
- Decide what “on‑topic” and “respectful” look like locally  
- Flag patterns of behavior that a classifier would miss

Our role is to:

- Provide good tools (flagging, muting, blocking, rate limits)  
- Document clearly what’s globally non‑negotiable  
- Back up community decisions when they’re within that envelope

If a server keeps running up against global policy, that’s a signal we either:

- Need to clarify the policy  
- Or accept that this is not a good fit for Parascene

## 5. The human side: appeals and trust

No matter how careful we are, we will:

- Block things we shouldn’t  
- Miss things we wish we had caught sooner

When that happens, what matters most is:

- **Appeal paths** that don’t feel like shouting into the void  
- **Honest communication** when we fix mistakes or change rules  
- A willingness to **update policy** when we learn something new

We’d rather be transparent about the fact that the system is imperfect than pretend everything is “handled.” This blog is one place we can do that in more than a tooltip’s worth of text.

