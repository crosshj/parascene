import bcrypt from "bcryptjs";
import { openDb } from "./index.js";

const SEED_USERS = [
  {
    email: "consumer@example.com",
    password: "p123@#",
    role: "consumer"
  },
  {
    email: "creator@example.com",
    password: "p123@#",
    role: "creator"
  },
  {
    email: "provider@example.com",
    password: "p123@#",
    role: "provider"
  },
  {
    email: "admin@example.com",
    password: "p123@#",
    role: "admin"
  }
];

const SEED_MODERATION = [
  {
    content_type: "post",
    content_id: "post_1042",
    status: "pending",
    reason: "Possible spam links"
  },
  {
    content_type: "comment",
    content_id: "comment_221",
    status: "review",
    reason: "Reported for harassment"
  },
  {
    content_type: "profile",
    content_id: "creator_88",
    status: "resolved",
    reason: "Impersonation report"
  }
];

const SEED_PROVIDERS = [
  {
    name: "Aurora Streaming",
    status: "active",
    region: "NA",
    contact_email: "ops@aurorastreaming.example.com"
  },
  {
    name: "Nimbus Render",
    status: "pending",
    region: "EU",
    contact_email: "support@nimbusrender.example.com"
  },
  {
    name: "Echo Cloud",
    status: "suspended",
    region: "APAC",
    contact_email: "trust@echocloud.example.com"
  }
];

const SEED_PROVIDER_STATUS = [
  {
    provider_name: "Aurora Streaming",
    status: "operational",
    region: "NA",
    uptime_pct: 99.98,
    capacity_pct: 72
  },
  {
    provider_name: "Nimbus Render",
    status: "degraded",
    region: "EU",
    uptime_pct: 98.62,
    capacity_pct: 91
  },
  {
    provider_name: "Echo Cloud",
    status: "maintenance",
    region: "APAC",
    uptime_pct: 97.45,
    capacity_pct: 44
  }
];

const SEED_PROVIDER_METRICS = [
  {
    name: "Jobs processed",
    value: "12,480",
    unit: "jobs",
    change: "+4.2%",
    period: "Last 7 days",
    description: "Completed renders across all regions."
  },
  {
    name: "Average queue time",
    value: "3.6",
    unit: "min",
    change: "-12%",
    period: "Last 24 hours",
    description: "Median time from submission to start."
  },
  {
    name: "GPU utilization",
    value: "78",
    unit: "%",
    change: "+5%",
    period: "Last 7 days",
    description: "Weighted average utilization across clusters."
  },
  {
    name: "Failed runs",
    value: "14",
    unit: "runs",
    change: "-3",
    period: "Last 7 days",
    description: "Automated retry failures requiring review."
  }
];

const SEED_PROVIDER_GRANTS = [
  {
    name: "Sustainability Compute Fund",
    sponsor: "OpenRender Alliance",
    amount: "$48,000",
    status: "active",
    next_report: "2026-02-15"
  },
  {
    name: "Realtime Collaboration Pilot",
    sponsor: "Visor Labs",
    amount: "$22,500",
    status: "pending renewal",
    next_report: "2026-01-28"
  },
  {
    name: "Creator Accelerator Credits",
    sponsor: "Parascene Labs",
    amount: "$15,000",
    status: "active",
    next_report: "2026-03-10"
  }
];

const SEED_PROVIDER_TEMPLATES = [
  {
    name: "Realtime Preview Pipeline",
    category: "Streaming",
    version: "v2.4",
    deployments: 18
  },
  {
    name: "Distributed Cache Mesh",
    category: "Infrastructure",
    version: "v1.9",
    deployments: 9
  },
  {
    name: "Latency Guardrails",
    category: "Monitoring",
    version: "v3.1",
    deployments: 27
  }
];

const SEED_POLICIES = [
  {
    key: "content.flag.threshold",
    value: "3",
    description: "Reports required before auto-review"
  },
  {
    key: "provider.max.concurrent.jobs",
    value: "25",
    description: "Maximum concurrent jobs per provider"
  },
  {
    key: "creator.payout.minimum",
    value: "$50",
    description: "Minimum payout threshold"
  }
];

const SEED_NOTIFICATIONS = [
  {
    audience: "role",
    role: "admin",
    title: "Moderation queue updated",
    message: "3 new items require review, including two flagged comments and one profile report that needs attention.",
    link: "/moderation"
  },
  {
    audience: "role",
    role: "creator",
    title: "Payout scheduled",
    message: "Your next payout is scheduled for Friday and includes earnings from the last two weeks of subscriptions.",
    link: "/earnings"
  },
  {
    audience: "role",
    role: "provider",
    title: "Capacity threshold reached",
    message: "Your provider node is at 85% capacity. Consider scaling up or pausing lower-priority jobs to maintain performance.",
    link: "/providers"
  },
  {
    audience: "role",
    role: "consumer",
    title: "New recommendations ready",
    message: "Check out new content tailored for you.",
    link: "/feed"
  },
  {
    audience: "user",
    email: "admin@example.com",
    title: "System health alert",
    message: "Latency spiked in EU region.",
    link: "/providers"
  },
  {
    audience: "user",
    email: "creator@example.com",
    title: "New subscriber",
    message: "You have a new subscriber this week.",
    link: "/profile"
  },
  {
    audience: "role",
    role: "admin",
    title: "Policy change pending",
    message: "Review the new policy knob updates before publishing to ensure they align with the latest compliance guidance.",
    link: "/policies"
  },
  {
    audience: "role",
    role: "admin",
    title: "Provider verification needed",
    message: "2 providers are awaiting verification.",
    link: "/providers"
  },
  {
    audience: "role",
    role: "creator",
    title: "Post flagged",
    message: "One of your posts was flagged for review.",
    link: "/posts"
  },
  {
    audience: "role",
    role: "creator",
    title: "Weekly engagement summary",
    message: "Your views are up 12% week over week, with the biggest lift coming from the new tutorial series.",
    link: "/dashboard"
  },
  {
    audience: "role",
    role: "provider",
    title: "Maintenance window scheduled",
    message: "Planned maintenance on Sunday at 02:00 UTC. Expect brief interruptions while we apply security patches.",
    link: "/providers"
  },
  {
    audience: "role",
    role: "provider",
    title: "New region available",
    message: "APAC region now available for deployment.",
    link: "/providers"
  },
  {
    audience: "role",
    role: "consumer",
    title: "Account security tip",
    message: "Enable two-factor authentication for added security and sign-in alerts on your account.",
    link: "/profile"
  },
  {
    audience: "role",
    role: "consumer",
    title: "Trending creators",
    message: "Check out the creators trending this week.",
    link: "/explore"
  },
  {
    audience: "user",
    email: "provider@example.com",
    title: "Billing update",
    message: "Your billing statement is ready to view, including a breakdown of usage and storage costs.",
    link: "/billing"
  },
  {
    audience: "user",
    email: "consumer@example.com",
    title: "Welcome back",
    message: "We missed you. Here are new picks for you.",
    link: "/feed"
  }
];

const SEED_FEED = [
  {
    title: "Neon skyline study",
    summary: "A quick breakdown of the lighting setup used to get soft neon bounce in a rainy alley scene.",
    author: "Ari Kim",
    tags: "lighting,neon,city"
  },
  {
    title: "Foliage brush pack",
    summary: "A compact brush pack for fast foliage blocking with a focus on silhouette variety.",
    author: "Vale Studio",
    tags: "brushes,foliage,kit"
  },
  {
    title: "Motion tests: hover drones",
    summary: "Test passes for a hover drone rig with focus on stability and drift.",
    author: "K. Ramirez",
    tags: "animation,rigging,drones"
  }
];

const FEED_AUTHORS = [
  "Ari Kim",
  "Vale Studio",
  "K. Ramirez",
  "Jun Park",
  "Mila Ortiz",
  "S. Patel",
  "Nova Labs",
  "Cass Li",
  "Theo Grant",
  "Iris Chen"
];

const FEED_TITLES = [
  "City rain study",
  "Softbox portrait lighting",
  "Kitbash corridor pass",
  "Snow drift simulation",
  "Ocean shader tweaks",
  "Neon signage variants",
  "Studio turntable test",
  "Orbital camera motion",
  "Cloud layer stack",
  "Ruined temple blockout"
];

const FEED_SUMMARIES = [
  "Notes on light falloff and wet surface reflections for a night scene.",
  "Small adjustments that improved skin tones under neutral key lighting.",
  "Exploring panel density and silhouette readability in a tight space.",
  "Quick sim pass focusing on drift speed and edge softness.",
  "Refining specular breakup for calmer water at dusk.",
  "Trying new glyph shapes and emissive bloom levels.",
  "Testing a clean material stack for consistent renders.",
  "A motion pass focused on smooth ease-in curves.",
  "Layering low, mid, and high clouds for depth.",
  "Blocking primary forms before detailing the set."
];

const FEED_TAGS = [
  "lighting",
  "materials",
  "animation",
  "environment",
  "procedural",
  "render",
  "workflow",
  "shaders",
  "simulation",
  "composition"
];

const SEED_EXPLORE = [
  {
    title: "Desert chapel render",
    summary: "Exploring minimalist architecture in a high noon desert environment.",
    category: "Architecture"
  },
  {
    title: "Clay study: portraits",
    summary: "A series of clay renders focused on material response under studio lighting.",
    category: "Portraits"
  },
  {
    title: "Procedural ruins",
    summary: "Testing a node-based workflow for generating ruined columns and debris.",
    category: "Procedural"
  }
];

const SEED_POSTS = [
  {
    email: "creator@example.com",
    title: "Foggy bridge pass",
    body: "Uploaded a new pass with volumetric fog and soft backlighting. Looking for feedback on depth layering.",
    status: "published"
  },
  {
    email: "creator@example.com",
    title: "Shader notes: wet asphalt",
    body: "Collecting notes on the wet asphalt shader—mainly the roughness breakup and specular reflections.",
    status: "draft"
  },
  {
    email: "consumer@example.com",
    title: "Weekend kitbash",
    body: "A short kitbash session exploring industrial panels and greeble distribution.",
    status: "published"
  }
];

const SEED_SERVERS = [
  {
    name: "Orchid Render",
    region: "NA",
    status: "active",
    members_count: 128,
    description: "Shared rendering space with real-time previews and fast queue turnaround."
  },
  {
    name: "Lumen Cluster",
    region: "EU",
    status: "busy",
    members_count: 86,
    description: "High-throughput cluster optimized for GPU-heavy lighting passes."
  },
  {
    name: "Nimbus Edge",
    region: "APAC",
    status: "maintenance",
    members_count: 42,
    description: "Edge compute group for lightweight previews and draft exports."
  }
];

const SEED_TEMPLATES = [
  {
    name: "Moodboard Starter",
    category: "Pre-production",
    description: "A clean layout for collecting reference, color keys, and design notes."
  },
  {
    name: "Shot Breakdown",
    category: "Production",
    description: "Template for tracking shots, frame ranges, and dependencies."
  },
  {
    name: "Final Delivery Checklist",
    category: "Delivery",
    description: "A checklist for final exports, renders, and asset handoff."
  }
];

const { db, queries } = openDb();

for (const user of SEED_USERS) {
  const existing = queries.selectUserByEmail.get(user.email);
  if (existing) continue;

  const passwordHash = bcrypt.hashSync(user.password, 12);
  queries.insertUser.run(user.email, passwordHash, user.role);
}

const moderationCount = queries.selectModerationQueue.all().length;
if (moderationCount === 0) {
  for (const item of SEED_MODERATION) {
    db.prepare(
      `INSERT INTO moderation_queue (content_type, content_id, status, reason)
       VALUES (?, ?, ?, ?)`
    ).run(item.content_type, item.content_id, item.status, item.reason);
  }
}

const providerCount = queries.selectProviders.all().length;
if (providerCount === 0) {
  for (const provider of SEED_PROVIDERS) {
    db.prepare(
      `INSERT INTO provider_registry (name, status, region, contact_email)
       VALUES (?, ?, ?, ?)`
    ).run(
      provider.name,
      provider.status,
      provider.region,
      provider.contact_email
    );
  }
}

const providerStatusCount = db
  .prepare("SELECT COUNT(*) AS count FROM provider_statuses")
  .get().count;
if (providerStatusCount === 0) {
  for (const status of SEED_PROVIDER_STATUS) {
    db.prepare(
      `INSERT INTO provider_statuses
       (provider_name, status, region, uptime_pct, capacity_pct)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      status.provider_name,
      status.status,
      status.region,
      status.uptime_pct,
      status.capacity_pct
    );
  }
}

const providerMetricsCount = db
  .prepare("SELECT COUNT(*) AS count FROM provider_metrics")
  .get().count;
if (providerMetricsCount === 0) {
  for (const metric of SEED_PROVIDER_METRICS) {
    db.prepare(
      `INSERT INTO provider_metrics
       (name, value, unit, change, period, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      metric.name,
      metric.value,
      metric.unit,
      metric.change,
      metric.period,
      metric.description
    );
  }
}

const providerGrantsCount = db
  .prepare("SELECT COUNT(*) AS count FROM provider_grants")
  .get().count;
if (providerGrantsCount === 0) {
  for (const grant of SEED_PROVIDER_GRANTS) {
    db.prepare(
      `INSERT INTO provider_grants
       (name, sponsor, amount, status, next_report)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      grant.name,
      grant.sponsor,
      grant.amount,
      grant.status,
      grant.next_report
    );
  }
}

const providerTemplatesCount = db
  .prepare("SELECT COUNT(*) AS count FROM provider_templates")
  .get().count;
if (providerTemplatesCount === 0) {
  for (const template of SEED_PROVIDER_TEMPLATES) {
    db.prepare(
      `INSERT INTO provider_templates
       (name, category, version, deployments)
       VALUES (?, ?, ?, ?)`
    ).run(
      template.name,
      template.category,
      template.version,
      template.deployments
    );
  }
}

const policyCount = queries.selectPolicies.all().length;
if (policyCount === 0) {
  for (const policy of SEED_POLICIES) {
    db.prepare(
      `INSERT INTO policy_knobs (key, value, description)
       VALUES (?, ?, ?)`
    ).run(policy.key, policy.value, policy.description);
  }
}

const notificationsCount = db
  .prepare("SELECT COUNT(*) AS count FROM notifications")
  .get().count;
if (notificationsCount === 0) {
  for (const notification of SEED_NOTIFICATIONS) {
    let userId = null;
    if (notification.audience === "user" && notification.email) {
      const user = queries.selectUserByEmail.get(notification.email);
      userId = user?.id ?? null;
    }

    db.prepare(
      `INSERT INTO notifications (user_id, role, title, message, link)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      userId,
      notification.audience === "role" ? notification.role : null,
      notification.title,
      notification.message,
      notification.link
    );
  }
}

const feedCount = queries.selectFeedItems.all().length;
if (feedCount === 0) {
  for (const item of SEED_FEED) {
    db.prepare(
      `INSERT INTO feed_items (title, summary, author, tags)
       VALUES (?, ?, ?, ?)`
    ).run(item.title, item.summary, item.author, item.tags);
  }

  const targetFeedCount = 60;
  const generatedCount = Math.max(0, targetFeedCount - SEED_FEED.length);
  for (let i = 0; i < generatedCount; i += 1) {
    const title = FEED_TITLES[i % FEED_TITLES.length];
    const summary = FEED_SUMMARIES[i % FEED_SUMMARIES.length];
    const author = FEED_AUTHORS[i % FEED_AUTHORS.length];
    const tags = `${FEED_TAGS[i % FEED_TAGS.length]},${FEED_TAGS[(i + 3) % FEED_TAGS.length]}`;
    db.prepare(
      `INSERT INTO feed_items (title, summary, author, tags)
       VALUES (?, ?, ?, ?)`
    ).run(
      `${title} #${i + 1}`,
      summary,
      author,
      tags
    );
  }
}

const exploreCount = queries.selectExploreItems.all().length;
if (exploreCount === 0) {
  for (const item of SEED_EXPLORE) {
    db.prepare(
      `INSERT INTO explore_items (title, summary, category)
       VALUES (?, ?, ?)`
    ).run(item.title, item.summary, item.category);
  }
}

const creatorUser = queries.selectUserByEmail.get("creator@example.com");
const consumerUser = queries.selectUserByEmail.get("consumer@example.com");
const postsCount = db
  .prepare("SELECT COUNT(*) AS count FROM posts")
  .get().count;
if (postsCount === 0) {
  for (const post of SEED_POSTS) {
    const userId =
      post.email === "creator@example.com"
        ? creatorUser?.id
        : consumerUser?.id;
    if (!userId) continue;
    db.prepare(
      `INSERT INTO posts (user_id, title, body, status)
       VALUES (?, ?, ?, ?)`
    ).run(userId, post.title, post.body, post.status);
  }
}

const serversCount = queries.selectServers.all().length;
if (serversCount === 0) {
  for (const server of SEED_SERVERS) {
    db.prepare(
      `INSERT INTO servers (name, region, status, members_count, description)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      server.name,
      server.region,
      server.status,
      server.members_count,
      server.description
    );
  }
}

const templatesCount = queries.selectTemplates.all().length;
if (templatesCount === 0) {
  for (const template of SEED_TEMPLATES) {
    db.prepare(
      `INSERT INTO templates (name, category, description)
       VALUES (?, ?, ?)`
    ).run(template.name, template.category, template.description);
  }
}

db.close();
console.log("Seed complete.");
