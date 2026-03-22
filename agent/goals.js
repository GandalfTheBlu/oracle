/**
 * Oracle Goal Tracking
 *
 * Manages persistent goals — concrete outcomes the user wants to achieve.
 * Goals are created automatically from conversation (background extraction)
 * or explicitly via the API. Execution history is stored per goal.
 *
 * Data lives in <dataDir>/goals.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDataDir } from './data-dir.js';

// ── Persistence ───────────────────────────────────────────────────────────────

function goalsPath() {
  return join(getDataDir(), 'goals.json');
}

function load() {
  const p = goalsPath();
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return []; }
}

function save(goals) {
  writeFileSync(goalsPath(), JSON.stringify(goals, null, 2), 'utf8');
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function listGoals(status = null) {
  const goals = load();
  return status ? goals.filter(g => g.status === status) : goals;
}

export function getGoal(id) {
  return load().find(g => g.id === id) ?? null;
}

export function createGoal(title, description = '') {
  const goals = load();
  const goal = {
    id: newId(),
    title: title.trim(),
    description: description.trim(),
    status: 'active',
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  goals.push(goal);
  save(goals);
  return goal;
}

export function updateGoal(id, patch) {
  const goals = load();
  const idx = goals.findIndex(g => g.id === id);
  if (idx === -1) return null;
  goals[idx] = { ...goals[idx], ...patch, updatedAt: new Date().toISOString() };
  save(goals);
  return goals[idx];
}

export function deleteGoal(id) {
  const goals = load();
  const idx = goals.findIndex(g => g.id === id);
  if (idx === -1) return false;
  goals.splice(idx, 1);
  save(goals);
  return true;
}

export function appendStep(goalId, summary, toolCount) {
  const goals = load();
  const idx = goals.findIndex(g => g.id === goalId);
  if (idx === -1) return;
  goals[idx].steps.push({ summary: summary.replace('[DONE]', '').trim(), toolCount, timestamp: new Date().toISOString() });
  goals[idx].updatedAt = new Date().toISOString();
  save(goals);
}

// ── Background goal extraction ─────────────────────────────────────────────────

/**
 * After a conversation turn, check whether the user expressed a new concrete goal.
 * Creates and persists a goal if one is detected. Fire-and-forget.
 */
export async function extractGoal(userMessage, assistantReply, llmCall) {
  try {
    const raw = await llmCall(
      [
        {
          role: 'system',
          content:
            'Did the user express a concrete goal or task to accomplish?\n' +
            'A goal is a concrete outcome: "refactor X", "add feature Y", "fix bug Z", "analyse Q and produce a report".\n' +
            'NOT a goal: questions, casual chat, requests for explanation only, one-word replies.\n' +
            'Respond with JSON only — no markdown, no other text:\n' +
            '{"isGoal":true,"title":"5-10 word imperative title","description":"1-2 sentences, specific outcome expected"}\n' +
            'or {"isGoal":false}',
        },
        { role: 'user', content: `User said: ${userMessage.slice(0, 400)}\nAssistant replied: ${assistantReply.slice(0, 200)}` },
      ],
      { maxTokens: 120, temperature: 0.1 },
    );

    const text = (typeof raw === 'string' ? raw : raw.content ?? '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const json = JSON.parse(jsonMatch[0]);
    if (!json.isGoal || !json.title) return null;

    const goal = createGoal(json.title, json.description ?? '');
    console.log(`[goals] Captured: "${goal.title}"`);
    return goal;
  } catch (err) {
    console.warn('[goals] Extraction failed:', err.message);
    return null;
  }
}
