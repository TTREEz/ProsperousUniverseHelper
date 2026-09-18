import { optimizeBase } from "@/optimizer/optimize";
import type { BasePhase, BasePhasePlan, BuildingPlanRow, OptimizerInput, PhaseBuildingDelta } from "@/optimizer/types";

const PHASE_AREA_FRACTIONS = [0.35, 0.55, 0.75, 1];
const MIN_OUTPUT_STEP = 0.03;

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mergeRowsByBuildingCode(rows: BuildingPlanRow[]) {
  const counts = new Map<string, BuildingPlanRow>();
  for (const row of rows) {
    const existing = counts.get(row.buildingCode);
    if (!existing) {
      counts.set(row.buildingCode, row);
      continue;
    }

    const purposes = [...new Set([...existing.purpose.split(", "), ...row.purpose.split(", ")])].filter(Boolean);
    counts.set(row.buildingCode, {
      ...existing,
      count: existing.count + row.count,
      slots: existing.slots + row.slots,
      requiredSlots: existing.requiredSlots + row.requiredSlots,
      totalArea: existing.totalArea + row.totalArea,
      purpose: purposes.join(", "),
    });
  }
  return counts;
}

function buildingSignature(rows: BuildingPlanRow[]) {
  return [...mergeRowsByBuildingCode(rows).values()]
    .map((row) => `${row.buildingCode}=${row.count}`)
    .sort()
    .join("|");
}

function calculateDeltas(previous: BuildingPlanRow[], next: BuildingPlanRow[]): PhaseBuildingDelta[] {
  const previousRows = mergeRowsByBuildingCode(previous);
  return [...mergeRowsByBuildingCode(next).values()]
    .map((row) => {
      const prior = previousRows.get(row.buildingCode);
      const previousCount = prior?.count ?? 0;
      const addCount = Math.max(0, row.count - previousCount);
      const areaDelta = Math.max(0, row.totalArea - (prior?.totalArea ?? 0));
      return {
        buildingCode: row.buildingCode,
        buildingName: row.buildingName,
        previousCount,
        nextCount: row.count,
        addCount,
        totalAreaAdded: row.areaEach === null ? areaDelta : row.areaEach * addCount,
        purpose: row.purpose,
      };
    })
    .filter((row) => row.addCount > 0)
    .sort((a, b) => b.totalAreaAdded - a.totalAreaAdded || a.buildingCode.localeCompare(b.buildingCode));
}

function phaseInput(input: OptimizerInput, areaCap: number): OptimizerInput {
  return {
    ...input,
    availableArea: areaCap,
    objectiveType: "MAXIMIZE_OUTPUT",
    targetAmount: null,
    targetPeriod: input.targetPeriod ?? "WEEK",
  };
}

export async function generateBasePhases(input: OptimizerInput): Promise<BasePhasePlan> {
  const finalArea = Math.max(1, input.availableArea);
  const candidateAreas = [...new Set(PHASE_AREA_FRACTIONS.map((fraction) => Math.max(1, Math.round(finalArea * fraction))))].sort((a, b) => a - b);
  if (candidateAreas[candidateAreas.length - 1] !== finalArea) candidateAreas.push(finalArea);

  const candidates = await Promise.all(candidateAreas.map(async (areaCap) => optimizeBase(phaseInput(input, areaCap))));
  const finalResult = candidates[candidates.length - 1];
  const finalTargetPerWeek = finalResult.summary.targetAchievedPerWeek;
  const phases: BasePhase[] = [];
  let previousBuildings: BuildingPlanRow[] = [];
  let previousSignature = "";
  let previousShare = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const result = candidates[index];
    const signature = buildingSignature(result.buildingPlan);
    const outputShare = finalTargetPerWeek > 0 ? result.summary.targetAchievedPerWeek / finalTargetPerWeek : null;
    const outputStep = outputShare === null ? 0 : outputShare - previousShare;
    const isFinal = index === candidates.length - 1;
    const hasOutput = result.summary.targetAchievedPerWeek > 0;
    const changed = signature !== previousSignature;

    if (!hasOutput && !isFinal) continue;
    if (!isFinal && phases.length > 0 && (!changed || outputStep < MIN_OUTPUT_STEP)) continue;

    phases.push({
      id: `phase-${phases.length + 1}`,
      index: phases.length + 1,
      name: isFinal ? "Final Form" : `Phase ${phases.length + 1}`,
      areaCap: result.summary.availableArea,
      outputShareOfFinal: outputShare === null ? null : round(Math.min(1, outputShare), 6),
      result,
      buildingDeltas: calculateDeltas(previousBuildings, result.buildingPlan),
    });

    previousBuildings = result.buildingPlan;
    previousSignature = signature;
    previousShare = outputShare ?? previousShare;
  }

  return {
    generatedAt: new Date().toISOString(),
    finalArea,
    finalTargetPerWeek,
    phases,
  };
}
