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
- [ ] Make it easy to turn a file into a creation. A loose upload should not stay a file that the rest of the app cannot publish, save, or adjust.
- [ ] Add crop, resize, and fit to image adjust, beside brightness, contrast, and saturation.
- [ ] Make available creation capabilities more discoverable.
- [ ] Explore LoRA integration and greater stylistic control.

Open questions:
- Should Parascene cater more to enthusiasts or casual creators?
- Can advanced capabilities be exposed without overwhelming casual users?
- Is maintaining older models worthwhile for LoRA support?

### Storage
Supabase is filling up. A cap has to land sooner or later, or the bill and the bucket grow with every draft.

- [ ] Limit what stays in Supabase.
- [ ] Auto-delete creations that are neither published nor saved after a set time.
- [ ] Keep published images. LoRA training should use that set, so expiry can take unpublished drafts without eating the training corpus.
- [ ] Keep anything a person saved. On desktop that means a folder or a project. The web does not offer that yet.
- [ ] Bring desktop folders and projects to the web, so saving is a real choice beside publish.
- [ ] Let people search images. A library you cannot search has to be kept small, or it is unusable.
- [ ] Offer a job that exports a person's library as a zip. Expiry is only fair if they can take their files first. The archive is a job, not a request that has to finish in the browser.
- [ ] Decide how files shared into chats and image comments survive expiry. A creation pasted into a message or a comment is still in use, even when it is unpublished and unsaved. One file can sit in many places, so removing one message must not delete the object while another chat or comment still shows it. Once nothing references it, and it was never published or saved, it can expire. Marking it unavailable today already hides it from those threads, so expiry has to follow the references or the threads break.
- [ ] Give admin a storage summary. Total size, and how much is published, saved, still shown in a chat or image comment, or only an unpublished draft. The cap is guesswork without that.
- [ ] Make it easy to turn a file into a creation. Until that happens, a loose file sits outside publish, save, search, export, and expiry. Crop, resize, and fit belong on that path too, next to brightness, contrast, and saturation, so the stored image is the one the person actually framed.

Open questions:
- How long does an unpublished, unsaved creation stay?
- Does expiry wait until the web can save into a folder or project, so a draft has somewhere to go besides publish?
- Is the LoRA set published images only?

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
- [ ] Lock the cost floor. Make Blue the normal generation path, and keep Replicate for overflow or paid runs.
- [ ] Bound Supabase storage. Expire unpublished, unsaved creations. Keep published images for LoRA, and keep anything saved in a folder or project. Keep a file that a chat or an image comment still shows, and delete the stored object only after the last of those references is gone. Folders, projects, and image search on the web are how a person keeps and finds what should not be deleted. A library export job lets them download the rest as a zip before it goes. Admin gets a storage summary so the bucket can be watched before it is full.
- [ ] Keep the home occupied when activity is thin. Leave an active challenge up, and leave the last winner up until the next one. Measure whether people come back.
- [ ] Turn a registration into one public act: a vote, a comment, or a challenge entry. Any credit reward spends on Blue.

### Deferred
- [ ] LoRA, older models, and the enthusiast-versus-casual question, until the bill is stable. The feature waits. The storage rule does not: published images stay, because that is the training set.
- [ ] Integrated AI assistant.
- [ ] User-created challenges and credit prize pools.
- [ ] Sidebar cleanup, mobile layout, and documentation, until the home reliably has something in it.
