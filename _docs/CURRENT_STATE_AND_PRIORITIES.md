# Parascene — Current State and Priorities

## Recent Progress

### Homepage
- [x] Introduced a homepage featuring images, videos, songs, challenges, comments, newbies, and articles.
- [x] Improved the visibility of community activity over the traditional feed.
- [ ] Assess impact on engagement.

Observations:
- Inspired by SocialDiff and Suno.
- Better communicates the breadth of activity on Parascene.
- No significant increase in activity observed yet.

### Infrastructure
- [x] Refactored frontend and portions of backend.
- [x] Consolidated application into a single-page app.
- [x] Migrated most infrastructure to an AWS VPS.
- [ ] Eliminate remaining Vercel dependencies and costs.
- [ ] Assess ongoing hosting costs and stability.

### Competitor Research
- [x] Explored SocialDiff in response to user interest in LoRAs.
- [x] Identified opportunities to improve the homepage and creation experience.
- [ ] Continue evaluating relevant competitor features.

## Potential Work

### Creation Flow
- [ ] Simplify the overall creation experience.
- [ ] Reconsider the separation between basic and advanced creation.
- [ ] Reduce friction when performing repeated generations.
- [ ] Simplify uploading and using external images.
- [ ] Make available creation capabilities more discoverable.
- [ ] Explore LoRA integration and greater stylistic control.

Open questions:
- Should Parascene cater more to enthusiasts or casual creators?
- Can advanced capabilities be exposed without overwhelming casual users?
- Is maintaining older models worthwhile for LoRA support?

### Generation Economics
- [ ] Reduce dependence on Replicate.
- [ ] Assess the capacity and scalability of Parascene Blue.
- [ ] Determine how access to paid models should be managed.

Options:
- Restrict Replicate models to paying subscribers.
- Establish daily allowances for paid models.
- Make Blue the default generation provider.
- Consider separate credit types, as NightCafe does.

### Navigation and Layout
- [ ] Simplify the desktop sidebar.
- [ ] Improve feature discoverability.
- [ ] Bring the mobile experience closer to the desktop homepage.
- [ ] Reduce overall interface complexity.

### Onboarding and Gamification
- [ ] Introduce an onboarding sidebar.
- [ ] Guide new users through initial activities.
- [ ] Reward onboarding completion with 100 credits.
- [ ] Make the next meaningful action obvious.
- [ ] Improve conversion from registration to participation.

Problem: People are registering but not interacting.

### Integrated AI Assistant
- [ ] Explore an LLM-powered sidebar.
- [ ] Provide integrated prompt assistance.
- [ ] Answer questions about Parascene.
- [ ] Allow the assistant to perform application actions.
- [ ] Guide users through the creation process.
- [ ] Reduce dependence on external tools like ChatGPT.

### Content Discovery
- [ ] Introduce dedicated homepage sections for series, characters, and worlds.
- [ ] Promote recurring creative projects.
- [ ] Improve discovery of interconnected creations.

### Challenges and Contests
- [ ] Allow users to create their own challenges.
- [ ] Allow users to contribute credits toward prizes.
- [ ] Encourage community ownership of contests.

Observation: Challenges are already working relatively well.

### Documentation and Education
- [ ] Write articles explaining creation workflows.
- [ ] Publish generation tips and techniques.
- [ ] Document common use cases.
- [ ] Use documentation exercises to identify unnecessary steps and UX friction.

Documentation should serve both as an educational resource and as a means of evaluating the application itself.

## Prioritization

Evaluate each opportunity against:

- Acquisition
- Activation
- Engagement
- Retention
- Monetization
- Operating costs
- Development effort
- Ongoing maintenance

### Selected Priorities
- [ ] Lock the cost floor. Drop the remaining Vercel costs, make Blue the normal generation path, and keep Replicate for overflow or paid runs.
- [ ] Keep the home occupied when activity is thin. Leave an active challenge up, and leave the last winner up until the next one. Measure whether people come back.
- [ ] Turn a registration into one public act: a vote, a comment, or a challenge entry. Any credit reward spends on Blue.

### Deferred
- [ ] LoRA, older models, and the enthusiast-versus-casual question, until the bill is stable.
- [ ] Integrated AI assistant.
- [ ] User-created challenges and credit prize pools.
- [ ] Sidebar cleanup, mobile layout, and documentation, until the home reliably has something in it.
