import bcrypt from "bcryptjs";
import { openDb } from "./index.js";

// Seed data
const seedData = {
  users: [
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
  ],

  moderation_queue: [
    {
      content_type: "creation",
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
  ],

  provider_registry: [
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
  ],

  provider_statuses: [
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
  ],

  provider_metrics: [
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
  ],

  provider_grants: [
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
  ],

  provider_templates: [
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
  ],

  policy_knobs: [
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
  ],

  notifications: [
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
      title: "Creation flagged",
      message: "One of your creations was flagged for review.",
      link: "/creations"
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
  ],

  feed_items: [
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
  ],

  feed_items_generated: {
    targetCount: 60,
    titles: [
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
    ],
    summaries: [
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
    ],
    authors: [
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
    ],
    tags: [
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
    ]
  },

  explore_items: [
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
  ],

  creations: [
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
  ],

  servers: [
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
  ],

  templates: [
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
  ]
};

// Seed execution
const { queries, seed } = await openDb();

(async () => {
  try {
    // Seed users (with password hashing)
    await seed("users", seedData.users, {
      skipIfExists: true,
      checkExists: async () => await queries.selectUsers.all(),
      transform: (user) => ({
        email: user.email,
        password_hash: bcrypt.hashSync(user.password, 12),
        role: user.role
      })
    });

    // Seed moderation_queue
    await seed("moderation_queue", seedData.moderation_queue, {
      skipIfExists: true,
      checkExists: async () => await queries.selectModerationQueue.all()
    });

    // Seed provider_registry
    await seed("provider_registry", seedData.provider_registry, {
      skipIfExists: true,
      checkExists: async () => await queries.selectProviders.all()
    });

    // Seed provider_statuses
    await seed("provider_statuses", seedData.provider_statuses, {
      skipIfExists: true
    });

    // Seed provider_metrics
    await seed("provider_metrics", seedData.provider_metrics, {
      skipIfExists: true
    });

    // Seed provider_grants
    await seed("provider_grants", seedData.provider_grants, {
      skipIfExists: true
    });

    // Seed provider_templates
    await seed("provider_templates", seedData.provider_templates, {
      skipIfExists: true
    });

    // Seed policy_knobs
    await seed("policy_knobs", seedData.policy_knobs, {
      skipIfExists: true,
      checkExists: async () => await queries.selectPolicies.all()
    });

    // Seed notifications (with user_id lookups)
    const notificationsToSeed = [];
    for (const notification of seedData.notifications) {
      let userId = null;
      if (notification.audience === "user" && notification.email) {
        const user = await queries.selectUserByEmail.get(notification.email);
        userId = user?.id ?? null;
      }

      notificationsToSeed.push({
        user_id: userId,
        role: notification.audience === "role" ? notification.role : null,
        title: notification.title,
        message: notification.message,
        link: notification.link
      });
    }

    await seed("notifications", notificationsToSeed, {
      skipIfExists: true
    });

    // Seed explore_items
    await seed("explore_items", seedData.explore_items, {
      skipIfExists: true,
      checkExists: async () => await queries.selectExploreItems.all()
    });

    // Seed creations (with user_id lookups) - DISABLED: creations table not seeded
    // const creatorUser = await queries.selectUserByEmail.get("creator@example.com");
    // const consumerUser = await queries.selectUserByEmail.get("consumer@example.com");

    // const creationsToSeed = seedData.creations
    //   .map((creation) => {
    //     const userId =
    //       creation.email === "creator@example.com"
    //         ? creatorUser?.id
    //         : consumerUser?.id;
    //     if (!userId) return null;

    //     return {
    //       user_id: userId,
    //       title: creation.title,
    //       body: creation.body,
    //       status: creation.status
    //     };
    //   })
    //   .filter(Boolean);

    // await seed("creations", creationsToSeed, {
    //   skipIfExists: true
    // });

    // Seed servers
    await seed("servers", seedData.servers, {
      skipIfExists: true,
      checkExists: async () => await queries.selectServers.all()
    });

    // Seed templates
    await seed("templates", seedData.templates, {
      skipIfExists: true,
      checkExists: async () => await queries.selectTemplates.all()
    });

    console.log("Seed complete.");
  } catch (error) {
    console.error("Seed error:", error);
    process.exit(1);
  }
})();
