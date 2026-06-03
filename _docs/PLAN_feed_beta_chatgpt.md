PARASCENE DISCOVERY FEED SPEC

Goal

We are not building a random feed.

We are replacing a chronological/follow-first feed with a discovery feed whose goal is to increase clicks, likes, comments, replies, follows, and creator-to-creator interaction per real feed impression.

The feed is correct when it increases meaningful_interactions_per_100_seen_items.

Meaningful interaction should weight comments/replies higher than likes:

meaningfulInteraction =
  click * 1
  + like * 2
  + comment * 6
  + reply * 8
  + followFromItem * 5

The feed should feel like:

1. What is hot today?
2. What was active recently / yesterday?
3. What is new?
4. What underseen catalog item deserves another chance?
5. Who is new or low-exposure?
6. What are people commenting on?
7. What happened on my own creations?

Do not simply randomize all creations.

Randomness is allowed only as weighted sampling inside ranked pools.


First Task: Audit Existing Implementation

Before changing code, inspect the current feed implementation and report whether it already does each of the following.

For each item, say:

- already implemented
- partially implemented
- not implemented
- unclear / needs more inspection

Audit checklist:

1. Does the feed use ranked candidate pools, or does it mostly randomize from all content?
2. Does it have a hot-24h pool?
3. Does it have a recent/yesterday/hot-7d pool?
4. Does it include fresh new creations even before engagement exists?
5. Does it intentionally resurface older underseen catalog items?
6. Does it give new creators / low-exposure creators extra visibility?
7. Does it include followed creators only as a small sprinkle, not as the dominant feed?
8. Does it include the viewer’s own creations only when there is new activity?
9. Does it track real viewport impressions, not merely server-returned items?
10. Does it track source_pool and position for each shown item?
11. Does it measure likes/comments/replies per impression by source_pool?
12. Does it avoid recently seen items per user?
13. Does it cap repeated creators per page?
14. Does page 1 reshuffle on new visit/refresh?
15. Does page 2+ remain stable within the same feed session?
16. Does the mobile front page preserve the required video/non-video pattern?
17. Does the mobile pattern still preserve ranking priority, or does it accidentally turn into random content?

If the current system already does some of this, say so. Do not rebuild working parts unnecessarily.

If the current system appears to produce a random-looking feed, identify why. Likely causes include:

- uniform random sampling from all creations
- ranking computed but ignored
- media-type slots overriding priority
- no hot/recent/new/catalog pool separation
- no seen tracking
- no source-pool metrics
- too much catalog randomness
- follow feed still dominating


Core Feed Model

Build a ranked pool-mixed feed.

The feed is assembled from candidate pools. Each pool has a job.

Candidate pools:

hot24:
  Items with the strongest interaction signal in the last 24 hours.
  This answers: "What is hot today?"

hotRecent:
  Items active in the last 2–7 days, excluding obvious hot24 winners.
  This answers: "What was hot yesterday / recently?"

new:
  Freshly published creations.
  These need exposure even before they have engagement.

underseenCatalog:
  Older creations that have decent quality signals but low recent impressions.
  This gives the site memory and prevents stale today-only behavior.

newCreator:
  Creations from new users or users with low total exposure.
  This prevents new people from posting into the void.

recentComment:
  Items with recent comments/replies.
  This exposes conversation and drives more replies.

followSprinkle:
  A small number of creations from followed users.
  Follows should boost visibility but must not dominate.

ownActivity:
  The viewer’s own creations only when they have new likes/comments/replies.
  This is a creator feedback loop, not discovery content.


Important Correction

Do not sort the entire database globally.

Do not uniformly randomize the catalog.

Do not let follow-content dominate.

Do not let the video/non-video mobile layout erase priority.

Correct approach:

1. Build ranked pools.
2. For each slot, choose the intended pool and media type.
3. Pull ranked candidates from that pool filtered by media type.
4. Apply seen penalties and creator diversity caps.
5. Weighted-sample from the best candidates.
6. Fill fallbacks from nearby pools if needed.


Mobile Front Page Constraint

The mobile front page must follow this content-type pattern:

Group 1:
  4 video slots
  3 non-video slots

Group 2:
  4 video slots
  3 non-video slots

Group 3:
  4 video slots
  3 non-video slots

Total:
  21 slots
  12 video
  9 non-video

This pattern is required, but it is only a media-type layout constraint.

It must not become:

"pick 12 random videos and 9 random non-videos"

Each slot still needs a source-pool priority.

For each mobile slot, satisfy both requirements:

1. desired media_type
2. desired source_pool


Mobile Front Page Slot Plan

Use this as the initial mobile page-1 shape.

Slot 01: video     hot24
Slot 02: video     hot24
Slot 03: video     recentComment
Slot 04: video     hotRecent
Slot 05: nonVideo  hot24
Slot 06: nonVideo  new
Slot 07: nonVideo  underseenCatalog

Slot 08: video     new
Slot 09: video     hot24
Slot 10: video     underseenCatalog
Slot 11: video     newCreator
Slot 12: nonVideo  hotRecent
Slot 13: nonVideo  recentComment
Slot 14: nonVideo  underseenCatalog

Slot 15: video     hotRecent
Slot 16: video     new
Slot 17: video     underseenCatalog
Slot 18: video     newCreator
Slot 19: nonVideo  followSprinkle
Slot 20: nonVideo  ownActivity
Slot 21: nonVideo  ownActivity

This preserves the mobile visual rhythm while still front-loading aliveness.

The top of the feed should immediately show:

- hot today
- recent conversation
- recent activity
- one fresh item

The middle should mix:

- new
- recent
- catalog
- new creators

The bottom should include:

- more catalog/newcomer content
- followed-user sprinkle
- own activity if present


Desktop / General Feed Shape

For a larger 30-item feed page, use something like this:

Slot 01: hot24
Slot 02: hot24
Slot 03: recentComment
Slot 04: new
Slot 05: hotRecent
Slot 06: underseenCatalog
Slot 07: newCreator
Slot 08: hot24
Slot 09: new
Slot 10: underseenCatalog
Slot 11: hotRecent
Slot 12: followSprinkle
Slot 13: underseenCatalog
Slot 14: new
Slot 15: recentComment
Slot 16: underseenCatalog
Slot 17: newCreator
Slot 18: hotRecent
Slot 19: new
Slot 20: underseenCatalog
Slot 21: hot24
Slot 22: followSprinkle
Slot 23: underseenCatalog
Slot 24: newCreator
Slot 25: hotRecent
Slot 26: new
Slot 27: underseenCatalog
Slot 28: recentComment
Slot 29: ownActivity
Slot 30: ownActivity

This is not mandatory, but the shape matters:

Top:
  hot today
  active discussion
  recent activity

Middle:
  new
  recent
  catalog
  new creators

Sprinkled:
  follows
  own activity


Fallback Rules

If a slot’s exact pool + media type has too few candidates, use nearby fallback pools.

hot24 video fallback:
  hotRecent video
  recentComment video
  new video
  underseenCatalog video

hotRecent fallback:
  hot24
  recentComment
  underseenCatalog

new fallback:
  newCreator
  underseenCatalog
  hotRecent

newCreator fallback:
  new
  underseenCatalog

ownActivity fallback:
  recentComment
  followSprinkle
  underseenCatalog

followSprinkle fallback:
  hotRecent
  underseenCatalog
  new

Do not leave slots empty unless there truly are no valid candidates.

Do not fill a hot slot with totally random content unless all hot/recent candidates are exhausted.


Scoring

Use simple scoring first.

interactionValue =
  clicks * 1
  + likes * 2
  + comments * 6
  + replies * 8
  + followsFromItem * 5

Use Bayesian smoothing so small samples do not lie:

adjustedRate =
  (itemInteractions + globalAverageInteractionRate * 30)
  / (itemImpressions + 30)

hot24Score =
  bayesianAdjustedInteractionRate24h
  * log(1 + interactionValue24h)
  * recencyDecay

hotRecentScore =
  bayesianAdjustedInteractionRate7d
  * log(1 + interactionValue7d)
  * recentActivityBoost

catalogScore =
  bayesianAdjustedLifetimeInteractionRate
  * underseenBoost
  * notRecentlySeenBoost

newScore =
  freshnessBoost
  * creatorExposureBoost
  * earlyInteractionSignal

newCreatorScore =
  freshnessBoost
  * lowCreatorExposureBoost
  * earlyInteractionSignal

recentCommentScore =
  recentCommentCount
  * replyCountBoost
  * recencyDecay

followScore =
  baseScore * 1.15

The follow boost should be small. Followed creators may also receive a few explicit slots, but the feed must not become follow-first.


Seen Handling

Track user-level seen state.

Never seen by this user:
  full score

Seen in last 24h:
  exclude unless hot24 or ownActivity

Seen once before:
  heavy penalty

Seen 2+ times:
  near-zero score

Already liked/commented by viewer:
  usually exclude from discovery slots

Viewer’s own item:
  exclude from normal discovery slots
  include only in ownActivity if there is new activity

An item should count as seen only when it actually appears in the viewport, for example:

50% visible for at least 1 second

Do not count server-returned-but-never-viewed items as impressions.


Diversity Rules

No duplicate creations in a feed session.

Max 2 creations from the same creator per page.

New creators must not be blocked by the follow graph.

Followed creators should appear but not dominate.

Items with recent comments/replies should get extra oxygen.

Old catalog items should reappear only if:

- they are good enough
- they are underseen
- the viewer has not seen them recently

Page 1 can reshuffle on a new visit or refresh.

Page 2+ must use the same feed session so infinite scroll remains stable.


Feed Session Behavior

On feed open:

Generate about 100–200 candidate item IDs.
Store the feed session in Redis/Postgres with TTL.
Return page 1.

On page 2+:

Continue from the stored feed session.
Do not reshuffle the feed while the user is scrolling.

On refresh / new login / new visit:

Create a new feed session.
Page 1 can feel fresh again.

This gives the site a living feeling without making scrolling feel unstable.


Minimum Data Model

creation_stats:
  creation_id
  creator_id
  media_type: video | nonVideo
  created_at
  impressions_24h
  impressions_7d
  impressions_total
  clicks_24h
  clicks_7d
  likes_24h
  likes_7d
  comments_24h
  comments_7d
  replies_24h
  replies_7d
  follows_from_item_24h
  interactions_24h
  interactions_7d
  interactions_total
  last_interaction_at
  last_comment_at
  score_hot24
  score_hot_recent
  score_catalog
  score_new
  score_new_creator
  score_recent_comment
  updated_at

feed_events:
  user_id
  creation_id
  feed_session_id
  source_pool
  position
  media_type
  event_type: impression | click | like | comment | reply | followFromItem
  created_at

user_creation_seen:
  user_id
  creation_id
  first_seen_at
  last_seen_at
  seen_count
  clicked_at
  liked_at
  commented_at
  replied_at

feed_sessions:
  feed_session_id
  user_id
  seed
  creation_ids_ordered
  created_at
  expires_at


Implementation Outline

Function getFeed(userId, cursor, platform)

1. If cursor exists:
     load existing feed_session
     return next page from stored ordered IDs

2. If no cursor:
     create new feed_session

3. If platform is mobile and this is front page:
     use the required 21-slot mobile pattern:
       4 videos, 3 non-videos
       repeated 3 times

4. For each slot:
     identify desired media_type
     identify desired source_pool
     fetch ranked candidates for that source_pool and media_type
     remove already-picked items
     remove or penalize recently seen items
     apply creator diversity cap
     weighted-sample from top candidates
     if empty, use fallback pools

5. Store ordered IDs in feed_session.

6. Return creations with:
     creation data
     source_pool
     position
     feed_session_id
     reason label if useful


Reason Labels for UI

Feed cards should expose why something is being shown.

Useful labels:

Rising today
People are talking
New creation
New creator
From the catalog
Recently active
From someone you follow
People reacted to your creation

These labels help the feed feel alive because users understand there is activity behind the item.


Acceptance Tests

The result is wrong if:

- it looks like a random sample of all creations
- the first screen does not show anything hot/current/active
- new creations are buried
- new users get no exposure
- old catalog items appear with no quality or underseen logic
- followed users dominate the feed
- video slots are filled randomly without pool priority
- page 2 reshuffles unpredictably
- the system cannot report interactions per impression by source_pool

The result is right if:

- the first few slots show things active today
- recent/yesterday activity appears near the top
- new creations are interspersed
- older underseen creations appear regularly
- new creators get deliberate exposure
- followed creators appear lightly
- items with comments/replies get extra oxygen
- creator-owned items appear only when they have new activity
- mobile page 1 follows the 4-video / 3-non-video pattern repeated 3 times
- within that pattern, ranking still matters
- the system can measure meaningful_interactions_per_100_impressions by source_pool


Optimization Metric

Tune the feed by source_pool.

Track:

likes per 100 impressions
comments per 100 impressions
replies per 100 impressions
clicks per 100 impressions
follows per 100 impressions
meaningful interactions per 100 impressions
new creator first-interaction rate
creator response rate after receiving a comment
unique commenters per day

If a pool gets impressions but no interaction, reduce its slots or improve its candidate scoring.

If a pool drives comments/replies, give it more oxygen.

Do not optimize only for likes. Comments and replies matter more for Parascene because the goal is creator-to-creator interaction.


Most Likely Failure Mode

The current implementation may already be doing some of this.

If it is, preserve it.

But if the output still feels like a random shuffled catalog, the likely issue is that the system has lost the editorial shape.

A living feed is not "random old stuff."

A living feed is:

top:
  hot today
  currently discussed
  recently active

middle:
  new
  recent
  catalog worth resurfacing
  new creators

sprinkled:
  follows
  own activity

constrained by mobile:
  4 video slots
  3 non-video slots
  repeated 3 times

The media-type pattern is a layout constraint, not the ranking algorithm.