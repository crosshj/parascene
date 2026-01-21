import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TODO_PATH = path.resolve(__dirname, "..", "TODO.json");

function computePriority(time, impact) {
  return Math.round((impact * (100 - time)) / 100);
}

function normalizeDependencies(dependsOn) {
  if (!Array.isArray(dependsOn)) return [];
  return dependsOn
    .map((dep) => String(dep || "").trim())
    .filter((dep) => dep.length > 0);
}

function normalizeTodoItem(item) {
  const name = String(item?.name || "").trim();
  const description = String(item?.description || "").trim();
  const cost = Number(item?.cost ?? item?.time);
  const impact = Number(item?.impact);
  const dependsOn = normalizeDependencies(item?.dependsOn);
  const priority = Number.isFinite(cost) && Number.isFinite(impact)
    ? computePriority(cost, impact)
    : 0;
  return {
    name,
    description,
    cost,
    impact,
    dependsOn,
    priority
  };
}

function applyDependencyPriority(items) {
  const byName = new Map(items.map((item) => [item.name, item]));
  let updated = true;
  let guard = 0;
  const maxIterations = Math.max(items.length * 4, 10);

  while (updated && guard < maxIterations) {
    updated = false;
    guard += 1;
    for (const item of items) {
      for (const depName of item.dependsOn || []) {
        const dependency = byName.get(depName);
        if (!dependency) continue;
        if (item.priority >= dependency.priority) {
          const boostedPriority = Math.min(100, item.priority + 1);
          if (boostedPriority > dependency.priority) {
            dependency.priority = boostedPriority;
            updated = true;
          }
        }
      }
    }
  }
}

async function readTodoItems() {
  const raw = await fs.readFile(TODO_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const items = parsed.map(normalizeTodoItem);
  applyDependencyPriority(items);
  return items;
}

async function writeTodoItems(items) {
  const normalized = items.map((item) => ({
    name: String(item?.name || "").trim(),
    description: String(item?.description || "").trim(),
    cost: Number(item?.cost ?? item?.time),
    impact: Number(item?.impact),
    dependsOn: normalizeDependencies(item?.dependsOn)
  }));
  await fs.writeFile(TODO_PATH, JSON.stringify(normalized, null, 2), "utf8");
}

export default function createTodoRoutes() {
  const router = express.Router();

  router.get("/api/todo", async (req, res) => {
    try {
      const items = await readTodoItems();
      res.json({
        items: items.map((item) => ({
          name: item.name,
          description: item.description,
          time: item.cost,
          impact: item.impact,
          priority: item.priority
        })),
        writable: !process.env.VERCEL,
        formula: "round(Impact * (100 - Cost) / 100), deps bumped +1"
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to read TODO.json." });
    }
  });

  router.post("/api/todo", async (req, res) => {
    if (process.env.VERCEL) {
      return res.status(403).json({ error: "TODO.md writes are disabled on Vercel." });
    }

    const { name, description, time, impact } = req.body || {};
    const normalizedName = String(name || "").trim();
    const normalizedDescription = String(description || "").trim();
    const timeValue = Number(time);
    const impactValue = Number(impact);

    if (!normalizedName || !normalizedDescription) {
      return res.status(400).json({ error: "Name and description are required." });
    }
    if (!Number.isFinite(timeValue) || timeValue < 1 || timeValue > 100) {
      return res.status(400).json({ error: "Time must be a number from 1 to 100." });
    }
    if (!Number.isFinite(impactValue) || impactValue < 1 || impactValue > 100) {
      return res.status(400).json({ error: "Impact must be a number from 1 to 100." });
    }

    try {
      const items = await readTodoItems();
      const priorityValue = computePriority(timeValue, impactValue);
      items.push({
        name: normalizedName,
        description: normalizedDescription,
        cost: timeValue,
        impact: impactValue,
        priority: priorityValue
      });
      await writeTodoItems(items);
      res.json({
        ok: true,
        item: {
          name: normalizedName,
          description: normalizedDescription,
          time: timeValue,
          impact: impactValue,
          priority: priorityValue
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to update TODO.json." });
    }
  });

  router.put("/api/todo", async (req, res) => {
    if (process.env.VERCEL) {
      return res.status(403).json({ error: "TODO.md writes are disabled on Vercel." });
    }

    const { originalName, name, description, time, impact } = req.body || {};
    const normalizedOriginal = String(originalName || "").trim();
    const normalizedName = String(name || "").trim();
    const normalizedDescription = String(description || "").trim();
    const timeValue = Number(time);
    const impactValue = Number(impact);

    if (!normalizedOriginal) {
      return res.status(400).json({ error: "Original name is required." });
    }
    if (!normalizedName || !normalizedDescription) {
      return res.status(400).json({ error: "Name and description are required." });
    }
    if (!Number.isFinite(timeValue) || timeValue < 1 || timeValue > 100) {
      return res.status(400).json({ error: "Time must be a number from 1 to 100." });
    }
    if (!Number.isFinite(impactValue) || impactValue < 1 || impactValue > 100) {
      return res.status(400).json({ error: "Impact must be a number from 1 to 100." });
    }

    try {
      const items = await readTodoItems();
      const priorityValue = computePriority(timeValue, impactValue);
      const updatedItems = items.map((item) => {
        if (item.name !== normalizedOriginal) return item;
        return {
          name: normalizedName,
          description: normalizedDescription,
          cost: timeValue,
          impact: impactValue,
          priority: priorityValue
        };
      });
      await writeTodoItems(updatedItems);
      res.json({
        ok: true,
        item: {
          name: normalizedName,
          description: normalizedDescription,
          time: timeValue,
          impact: impactValue,
          priority: priorityValue
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to update TODO.json." });
    }
  });

  router.delete("/api/todo", async (req, res) => {
    if (process.env.VERCEL) {
      return res.status(403).json({ error: "TODO.md writes are disabled on Vercel." });
    }

    const { name } = req.body || {};
    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      return res.status(400).json({ error: "Name is required." });
    }

    try {
      const items = await readTodoItems();
      const updatedItems = items.filter((item) => item.name !== normalizedName);
      await writeTodoItems(updatedItems);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete todo item." });
    }
  });

  return router;
}
