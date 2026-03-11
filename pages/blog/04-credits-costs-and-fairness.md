---
title: "Credits, Costs, and Fairness in Generative Art"
description: "How Parascene thinks about credits, real infrastructure costs, and what 'fair' access to compute looks like in practice."
date: "2026-03-11"
---

Credits are the most visible part of a much deeper system: turning GPU time and storage into something people can understand and trust.

This post talks about:

- Why we use credits at all  
- How they map (imperfectly) to real costs  
- The fairness questions that keep coming up as we grow

## 1. Why credits instead of raw usage

We could meter everything directly:

- Seconds of GPU time  
- Resolution * steps  
- Bytes stored and served

That’s accurate but unusable.

Instead, credits give us:

- **A stable mental model**: “this kind of generation usually costs about X.”  
- **Room for optimization**: when we make something cheaper under the hood, we can reflect that by lowering credit prices over time.  
- **A way to bundle value**: credits can cover not just generation but add‑ons — higher resolution, variants, or richer editing.

Internally, we still track the raw stuff. Credits are the interface that sits on top.

## 2. What actually drives cost

Underneath the credit balance, there are a few big line items:

- **Model and GPU time**: the obvious one — different models and settings have very different cost profiles.  
- **Storage and bandwidth**: images and video live somewhere, and they have to be delivered quickly around the world.  
- **Overhead**: queues, safety filters, logs, and all the orchestration that makes the system feel “instant” when it’s working.

When we design credit prices, we look at:

- **Median cost** for a job type at current traffic  
- **Variability** (e.g. burstiness, long jobs that monopolize a worker)  
- **User impact**: how painful it would be if we were wrong on either side (too generous vs. too strict)

We err on the side of being generous and then adjust as we collect more real‑world data.

## 3. Free, paid, and in‑between

There are three overlapping goals:

1. Let people **try things for free** without friction.  
2. Make it **sustainable** to run the platform at quality.  
3. Create a path for **power users** who want to go deep.

Credits give us a few levers:

- Daily or periodic **free claims** that don’t require payment.  
- Bundled **subscription plans** that translate to a predictable monthly pool.  
- Occasional **event or server grants** where we can direct extra capacity toward a specific experience.

The tension is real:

- Too generous, and we risk having to dial back suddenly when bills arrive.  
- Too strict, and the product feels like a vending machine instead of a creative space.

We try to move slowly and communicate clearly whenever we adjust the mix.

## 4. Fairness isn’t just “equal credits for everyone”

There are different kinds of fairness we think about:

- **Access fairness**: can a new user meaningfully explore without paying?  
- **Creation fairness**: do expensive workflows crowd out simpler ones in the feed and discovery?  
- **Contribution fairness**: are people who bring value (hosts, moderators, teachers) recognized in the system?

Sometimes these are in tension. For example:

- Giving **more credits to active hosts** can feel unfair if it’s invisible to regular users.  
- Keeping **all credits flat** ignores the very real work of maintaining good communities.

We’re experimenting with:

- Transparent **server‑level rewards** tied to healthy activity, not just raw output.  
- Non‑credit forms of recognition (badges, placement, tooling) that don’t distort the core economy too much.  
- Better **per‑user analytics** so people understand where their credits are going.

## 5. Where we’re cautious

Things we’re intentionally slow about:

- **Pay‑to‑win surfaces**: we don’t want you to be able to buy your way to the top of discovery directly.  
- **Aggressive upsell flows**: nothing kills creative flow faster than feeling constantly nudged to pay.  
- **Over‑indexing on whales**: a platform that depends on a tiny group of heavy spenders has a very fragile future.

We’d rather:

- Keep the core experience approachable  
- Grow the community and value created  
- Let the economics follow that organic growth

Credits are just the current tool we’re using to balance those forces. If we find a better way to express and share costs over time, we’ll write about it here first.

