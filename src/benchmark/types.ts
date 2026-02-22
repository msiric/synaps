// src/benchmark/types.ts — Benchmark system type definitions

import type { ContributionPattern, Convention, AntiPattern } from "../types.js";

// ─── Conditions ──────────────────────────────────────────────────────────────

export type BenchmarkCondition =
  | "treatment"            // A: AGENTS.md + siblings + dir listing + reg/barrel
  | "realistic-control"    // B: siblings + dir listing + reg/barrel (no AGENTS.md)
  | "impoverished-control" // C: dir listing + reg/barrel only
  | "negative-control";    // N: shuffled AGENTS.md + dir listing + reg/barrel

// ─── Tasks ───────────────────────────────────────────────────────────────────

export type TaskTier = "A" | "B" | "C";

export interface BenchmarkTask {
  id: string;
  repoPath: string;
  packageName: string;
  tier: TaskTier;
  prompt: string;
  contributionPattern: ContributionPattern;
  conventions: Convention[];
  antiPatterns: AntiPattern[];
  expectedDirectory: string;
  expectedFilePattern: string;    // regex source string
  maxScoringPoints: number;
  context: TaskContext;
}

export interface TaskContext {
  siblingFiles: { path: string; content: string }[];
  registrationFile?: { path: string; content: string };
  barrelFile?: { path: string; content: string };
  directoryListing: string[];
}

// ─── Results ─────────────────────────────────────────────────────────────────

export interface BenchmarkResults {
  meta: {
    engineVersion: string;
    model: string;
    repoPath: string;
    timestamp: string;
    mode: "quick" | "full";
    conditions: BenchmarkCondition[];
  };
  summary: ConditionSummary;
  tasks: TaskResult[];
}

export interface ConditionSummary {
  tasksRun: number;
  conditions: Record<BenchmarkCondition, {
    meanScore: number;
    passRate: number;
    scores: number[];
    meanTokens: number;
  }>;
  headlineDelta: number;          // A - B (marginal value)
  upperBoundDelta: number;        // A - C
  pValue?: number;                // paired t-test on A-B (full mode only)
  effectSize?: number;            // Cohen's d on A-B (full mode only)
  ci95?: [number, number];        // 95% bootstrap CI on A-B delta
}

export interface TaskResult {
  taskId: string;
  tier: TaskTier;
  prompt: string;
  results: Record<BenchmarkCondition, RunResult>;
}

export interface RunResult {
  score: number;                  // 0-100 normalized
  rawScore: number;               // raw points earned
  maxPoints: number;              // max possible points for this tier
  passed: boolean;                // score >= 70%
  checks: CheckResult[];
  filesCreated: string[];
  tokensUsed: number;
  latencyMs: number;
  error?: string;
}

export interface CheckResult {
  name: string;
  category: "convention" | "integration" | "structure" | "quality";
  weight: number;
  score: number;
  passed: boolean;
  detail: string;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface BenchmarkOptions {
  repoPath: string;
  rootDir?: string;
  mode: "quick" | "full";
  model?: string;
  outputDir?: string;
  verbose?: boolean;
  dryRun?: boolean;
  maxTasks?: number;
}

// ─── Generated Files ─────────────────────────────────────────────────────────

export interface GeneratedFile {
  path: string;       // relative path
  content: string;
}
