import { ProviderRoutingSwarm } from "./particle-swarm.js";

const PROFILE = { failurePenalty: 3, latencyWeight: 1, feeWeight: 0.8 };

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeSyntheticProviders(count, random, { capacityBias = 1 } = {}) {
  return Array.from({ length: count }, () => ({
    baseApprovalRate: 0.975 + random() * 0.02,
    baseLatency: 120 + random() * 100,
    capacityShare: ((1 / count) * (0.6 + random() * 0.8)) * capacityBias,
    feeBps: 180 + random() * 120,
  }));
}

function providerPerformance(provider, share) {
  const congestion = Math.max(0, share / provider.capacityShare - 0.72);
  const approvalProbability = Math.max(
    0.4,
    provider.baseApprovalRate - congestion * 0.17,
  );
  const meanLatency = provider.baseLatency + 650 * congestion ** 2;
  return { approvalProbability, meanLatency };
}

function providerUtility(provider, share, bonus = 0) {
  const { approvalProbability, meanLatency } = providerPerformance(
    provider,
    share,
  );
  const expectedFailureCost = (1 - approvalProbability) * PROFILE.failurePenalty;
  const latencyCost = (meanLatency / 3500) * PROFILE.latencyWeight;
  const feeCost = (provider.feeBps / 10000) * PROFILE.feeWeight;
  return (
    approvalProbability - expectedFailureCost - latencyCost - feeCost + bonus
  );
}

/**
 * Simulates `sampleCount` actual transactions routed according to `shares`
 * and returns the realized sample-mean utility. This is what a real system
 * measures from live traffic — a noisy estimate of the closed-form
 * expectation `makeFitness` computes exactly.
 */
function makeNoisyFitness(providers, sampleCount, random) {
  return (shares) => {
    let total = 0;
    for (let sample = 0; sample < sampleCount; sample++) {
      const draw = random();
      let cumulative = 0;
      let providerIndex = providers.length - 1;
      for (let index = 0; index < shares.length; index++) {
        cumulative += shares[index];
        if (draw <= cumulative) {
          providerIndex = index;
          break;
        }
      }
      const provider = providers[providerIndex];
      const share = shares[providerIndex];
      const { approvalProbability, meanLatency } = providerPerformance(
        provider,
        share,
      );
      const approved = random() < approvalProbability;
      const latency = meanLatency * (0.85 + random() * 0.3);
      const feeCost = (provider.feeBps / 10000) * PROFILE.feeWeight;
      const latencyCost = (latency / 3500) * PROFILE.latencyWeight;
      total +=
        (approved ? 1 : -PROFILE.failurePenalty) - latencyCost - feeCost;
    }
    return total / sampleCount;
  };
}

function makeFitness(providers) {
  return (shares) =>
    shares.reduce(
      (total, share, index) => total + share * providerUtility(providers[index], share),
      0,
    );
}

function makeLandscapeFitness(
  providers,
  { discountIndex, discountThreshold, discountBonus },
) {
  return (shares) =>
    shares.reduce((total, share, index) => {
      const bonus =
        index === discountIndex && share >= discountThreshold
          ? discountBonus
          : 0;
      return total + share * providerUtility(providers[index], share, bonus);
    }, 0);
}

function greedyAllocate(fitness, dimensionCount, steps = 100) {
  const allocation = Array(dimensionCount).fill(1 / dimensionCount);
  const increment = 1 / steps;
  let evaluations = 1;
  let fitnessValue = fitness(allocation);

  for (let move = 0; move < steps * dimensionCount; move++) {
    let bestMove = null;
    let bestFitness = -Infinity;
    for (let from = 0; from < dimensionCount; from++) {
      if (allocation[from] < increment) continue;
      for (let to = 0; to < dimensionCount; to++) {
        if (from === to) continue;
        const candidate = [...allocation];
        candidate[from] -= increment;
        candidate[to] += increment;
        const candidateFitness = fitness(candidate);
        evaluations++;
        if (candidateFitness > bestFitness + 1e-10) {
          bestFitness = candidateFitness;
          bestMove = { from, to };
        }
      }
    }
    if (!bestMove) break;
    allocation[bestMove.from] -= increment;
    allocation[bestMove.to] += increment;
    fitnessValue = bestFitness;
  }

  return { allocation, fitness: fitnessValue, evaluations };
}

function psoAllocate(
  fitness,
  dimensionCount,
  { particleCount = 36, iterations = 150, random },
) {
  const swarm = new ProviderRoutingSwarm(dimensionCount, particleCount, random);
  let evaluations = 0;
  const countingFitness = (shares) => {
    evaluations++;
    return fitness(shares);
  };

  let best;
  for (let iteration = 0; iteration < iterations; iteration++) {
    best = swarm.step(countingFitness);
  }
  return { allocation: best.shares, fitness: best.fitness, evaluations };
}

function bruteForceOptimum(fitness, resolution = 300) {
  let best = -Infinity;
  let bestAllocation = null;
  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution - i; j++) {
      const a = i / resolution;
      const b = j / resolution;
      const c = 1 - a - b;
      const value = fitness([a, b, c]);
      if (value > best) {
        best = value;
        bestAllocation = [a, b, c];
      }
    }
  }
  return { fitness: best, allocation: bestAllocation };
}

const LANDSCAPE_DISCOUNT_INDEX = 2;
const LANDSCAPE_DISCOUNT_THRESHOLD = 0.55;
const LANDSCAPE_DISCOUNT_BONUS = 0.5;
const LANDSCAPE_HIT_TOLERANCE = 0.02;

/**
 * Multi-modal landscape stress test: one provider offers a volume-tiered
 * rebate once its allocation crosses a threshold. Reaching it requires
 * moving through allocations that are worse than the safe starting point,
 * so a greedy hill-climber (which only ever takes locally-improving steps)
 * gets stuck before the threshold, while a population-based swarm already
 * has candidates scattered past it.
 */
export function runLandscapeBenchmark({ trials = 30, seed = 4200 } = {}) {
  const records = [];
  let discountOptimalTrials = 0;
  let greedyHits = 0;
  let psoHits = 0;
  let greedyHitsWhenOptimal = 0;
  let psoHitsWhenOptimal = 0;
  let greedyGapSum = 0;
  let psoGapSum = 0;
  let greedyEvalSum = 0;
  let psoEvalSum = 0;

  for (let trial = 0; trial < trials; trial++) {
    const providers = makeSyntheticProviders(3, seededRandom(seed + trial * 733));
    const fitness = makeLandscapeFitness(providers, {
      discountIndex: LANDSCAPE_DISCOUNT_INDEX,
      discountThreshold: LANDSCAPE_DISCOUNT_THRESHOLD,
      discountBonus: LANDSCAPE_DISCOUNT_BONUS,
    });
    const reference = bruteForceOptimum(fitness, 300);
    const referenceCrossesThreshold =
      reference.allocation[LANDSCAPE_DISCOUNT_INDEX] >=
      LANDSCAPE_DISCOUNT_THRESHOLD - LANDSCAPE_HIT_TOLERANCE;
    if (referenceCrossesThreshold) discountOptimalTrials++;

    const greedy = greedyAllocate(fitness, 3, 150);
    const pso = psoAllocate(fitness, 3, {
      particleCount: 30,
      iterations: 120,
      random: seededRandom(seed + 5711 + trial * 101),
    });

    const greedyHit =
      greedy.allocation[LANDSCAPE_DISCOUNT_INDEX] >=
      LANDSCAPE_DISCOUNT_THRESHOLD - LANDSCAPE_HIT_TOLERANCE;
    const psoHit =
      pso.allocation[LANDSCAPE_DISCOUNT_INDEX] >=
      LANDSCAPE_DISCOUNT_THRESHOLD - LANDSCAPE_HIT_TOLERANCE;
    if (greedyHit) greedyHits++;
    if (psoHit) psoHits++;
    if (referenceCrossesThreshold && greedyHit) greedyHitsWhenOptimal++;
    if (referenceCrossesThreshold && psoHit) psoHitsWhenOptimal++;

    greedyGapSum += reference.fitness - greedy.fitness;
    psoGapSum += reference.fitness - pso.fitness;
    greedyEvalSum += greedy.evaluations;
    psoEvalSum += pso.evaluations;

    records.push({ reference, greedy, pso, referenceCrossesThreshold });
  }

  return {
    trials,
    discountOptimalTrials,
    discountThreshold: LANDSCAPE_DISCOUNT_THRESHOLD,
    greedy: {
      hitRate: greedyHits / trials,
      hitRateWhenOptimal: discountOptimalTrials
        ? greedyHitsWhenOptimal / discountOptimalTrials
        : null,
      meanGap: greedyGapSum / trials,
      meanEvaluations: greedyEvalSum / trials,
    },
    pso: {
      hitRate: psoHits / trials,
      hitRateWhenOptimal: discountOptimalTrials
        ? psoHitsWhenOptimal / discountOptimalTrials
        : null,
      meanGap: psoGapSum / trials,
      meanEvaluations: psoEvalSum / trials,
    },
    records,
  };
}

/**
 * Dimensional-scaling stress test: same style of smooth allocation problem
 * (no discontinuity) but with an increasing provider count, to compare how
 * search cost grows with dimensionality. Greedy re-evaluates every
 * from/to provider pair each move (O(providers^2) per move); the swarm's
 * per-iteration cost is governed by its (fixed) particle count.
 */
export function runScalingBenchmark({
  dimensionCounts = [3, 6, 9, 12, 16, 20, 25],
  trialsPerSize = 8,
  seed = 1000,
} = {}) {
  return dimensionCounts.map((dimensionCount) => {
    let greedyEvalSum = 0;
    let psoEvalSum = 0;
    let greedyUtilitySum = 0;
    let psoUtilitySum = 0;
    let greedyTimeSum = 0;
    let psoTimeSum = 0;

    for (let trial = 0; trial < trialsPerSize; trial++) {
      const providers = makeSyntheticProviders(
        dimensionCount,
        seededRandom(seed + dimensionCount * 97 + trial * 13),
      );
      const fitness = makeFitness(providers);

      const startGreedy = performance.now();
      const greedy = greedyAllocate(fitness, dimensionCount, 100);
      const startPso = performance.now();
      const pso = psoAllocate(fitness, dimensionCount, {
        particleCount: 36,
        iterations: 150,
        random: seededRandom(seed + 5000 + dimensionCount * 31 + trial * 7),
      });
      const endPso = performance.now();

      greedyEvalSum += greedy.evaluations;
      psoEvalSum += pso.evaluations;
      greedyUtilitySum += greedy.fitness;
      psoUtilitySum += pso.fitness;
      greedyTimeSum += startPso - startGreedy;
      psoTimeSum += endPso - startPso;
    }

    return {
      dimensionCount,
      greedy: {
        meanEvaluations: greedyEvalSum / trialsPerSize,
        meanUtility: greedyUtilitySum / trialsPerSize,
        meanTimeMs: greedyTimeSum / trialsPerSize,
      },
      pso: {
        meanEvaluations: psoEvalSum / trialsPerSize,
        meanUtility: psoUtilitySum / trialsPerSize,
        meanTimeMs: psoTimeSum / trialsPerSize,
      },
    };
  });
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}

/**
 * Noisy-evaluation stress test: instead of the closed-form expected
 * utility, the fitness function only sees the realized sample-mean of a
 * handful of simulated transactions per call — the same "noisy fitness"
 * a real system would have to optimize against. Greedy commits to a
 * from/to move as soon as one pairwise comparison looks best (never
 * revisited), so a single unlucky sample locks in a bad move permanently.
 * The swarm keeps drawing fresh samples across many particles every
 * iteration, so no single noisy read can permanently derail it.
 */
export function runNoiseBenchmark({
  trials = 40,
  sampleCount = 15,
  seed = 3000,
} = {}) {
  const greedyGaps = [];
  const psoGaps = [];
  let greedyEvalSum = 0;
  let psoEvalSum = 0;

  for (let trial = 0; trial < trials; trial++) {
    const providers = makeSyntheticProviders(3, seededRandom(seed + trial * 811));
    const trueFitness = makeFitness(providers);
    const reference = bruteForceOptimum(trueFitness, 250);

    const noisyFitness = makeNoisyFitness(
      providers,
      sampleCount,
      seededRandom(seed + 6000 + trial * 271),
    );

    const greedy = greedyAllocate(noisyFitness, 3, 150);
    const pso = psoAllocate(noisyFitness, 3, {
      particleCount: 30,
      iterations: 120,
      random: seededRandom(seed + 4000 + trial * 419),
    });

    greedyGaps.push(reference.fitness - trueFitness(greedy.allocation));
    psoGaps.push(reference.fitness - trueFitness(pso.allocation));
    greedyEvalSum += greedy.evaluations;
    psoEvalSum += pso.evaluations;
  }

  return {
    trials,
    sampleCount,
    greedy: {
      meanGap: mean(greedyGaps),
      stddevGap: standardDeviation(greedyGaps),
      worstGap: Math.max(...greedyGaps),
      meanEvaluations: greedyEvalSum / trials,
    },
    pso: {
      meanGap: mean(psoGaps),
      stddevGap: standardDeviation(psoGaps),
      worstGap: Math.max(...psoGaps),
      meanEvaluations: psoEvalSum / trials,
    },
  };
}
