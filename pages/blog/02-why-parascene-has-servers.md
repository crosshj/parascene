---
title: "Why Parascene Has Servers at All"
description: "How the idea of servers emerged in Parascene, what they unlock for creators and communities, and why we didn’t just build one global feed."
date: "2026-03-11"
---

From the outside, “servers” in Parascene can look like pure flavor — a bit of sci‑fi framing on top of a social app.

On the inside, they’re a bundle of tradeoffs about curation, incentives, and how people actually organize themselves around creative work.

This post explains why we built servers at all, what we get from them, and the problems they still create for us.

## 1. One global feed wasn’t enough

Our earliest experiments looked a lot like every other content system:

- A **global feed** ranked by engagement  
- A basic **following** graph  
- A few lightweight discovery surfaces

That worked for:

- Showing that the core generation loop was fun  
- Letting people stumble into interesting work  
- Stress‑testing the underlying infra

But we kept running into hard limits:

- **Taste conflicts**: people wanted radically different norms about what was “good”, “allowed”, or “on‑topic”.  
- **Scale conflicts**: a single feed flattens everything — small communities get buried, and early power users gain permanent advantage.  
- **Context conflicts**: the same image can be delightful in one context (private joke with friends) and confusing in another (cold start from the explore page).

We needed a way to *localize* norms, conversation, and curation without fragmenting the product into a thousand disconnected apps.

## 2. Servers as opinionated “rooms”

Servers are our answer to that tension.

They’re:

- **Spaces with a point of view**: a server can decide what it’s for — cozy moodboards, intense prompt‑crafting, live events, etc.  
- **Surfaces for curation**: owners and mods can highlight what matters locally, even if it would never dominate a global leaderboard.  
- **Places to experiment**: we can test new feed shapes, rewards, and moderation tools inside servers without destabilizing the whole network.

This lets us say:

- “Here is the main default experience”  
- **and also** “Here are pockets where different rules and aesthetics can thrive.”

That second clause is important; it’s where a lot of the most interesting creative behavior actually happens.

## 3. Servers as incentive engines

Credits and rewards are where servers get truly opinionated.

They give us hooks to:

- **Reward good hosting**: running a welcoming, well‑curated space is real work; servers let us attach benefits to that.  
- **Distribute attention more fairly**: instead of one global algorithm, we get many smaller ones, tuned to the people who care.  
- **Experiment with revenue sharing** over time: in the long run, we want creators and hosts to participate in upside.

Without servers, every change to economics is all‑or‑nothing:

- Either everyone gets a new reward scheme  
- Or nobody does

With servers, we can:

- Pilot **different credit flows** in a few spaces  
- Learn what feels fair (and what doesn’t)  
- Promote the good patterns up into the broader product

## 4. Technical costs of the server model

All of this comes at a price.

Servers make the system more complex to operate because we now have:

- Additional **routing logic**: feed queries, notifications, and rewards must all understand which server context they’re in.  
- More **state to store and index**: membership, roles, preferences, and per‑server configuration.  
- More **cache invalidation surfaces**: a change in one server’s policy can impact what a user sees in multiple places.

We accept that complexity because the alternative — a single global surface — keeps collapsing into the same dynamics we were trying to avoid.

But it does mean:

- More bugs to chase  
- More migrations to design carefully  
- More places where a seemingly small change can have unexpected second‑order effects

## 5. What we haven’t solved yet

Servers are very much a work in progress.

Some of the open questions:

- **Discovery**: how do you find the right server without treating it like yet another feed to rank?  
- **Onboarding**: when a new user lands, which server(s) should they see first, and how many choices is too many?  
- **Governance**: what happens when a server’s norms collide with global policy, or when leadership changes hands?

We don’t have perfect answers yet. We *do* know that:

- Servers give us a better vocabulary to talk about those problems.  
- They let us fix issues locally instead of “patching” the entire system at once.  
- They create room for communities we’d never have the courage (or context) to design ourselves.

That’s why they’re staying — even when they’re the source of some of our most difficult product and infrastructure bugs.

