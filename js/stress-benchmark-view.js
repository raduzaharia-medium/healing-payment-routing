function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

export function renderLandscapeBenchmark(result) {
  document.getElementById("landscapeGreedyHitRate").textContent =
    result.discountOptimalTrials
      ? `${Math.round(result.greedy.hitRateWhenOptimal * result.discountOptimalTrials)}/${result.discountOptimalTrials}`
      : "n/a";
  document.getElementById("landscapePsoHitRate").textContent =
    result.discountOptimalTrials
      ? `${Math.round(result.pso.hitRateWhenOptimal * result.discountOptimalTrials)}/${result.discountOptimalTrials}`
      : "n/a";
  document.getElementById("landscapeGreedyGap").textContent =
    result.greedy.meanGap.toFixed(5);
  document.getElementById("landscapePsoGap").textContent =
    result.pso.meanGap.toFixed(5);
  document.getElementById("landscapeGreedyEvaluations").textContent =
    Math.round(result.greedy.meanEvaluations).toLocaleString();
  document.getElementById("landscapePsoEvaluations").textContent =
    Math.round(result.pso.meanEvaluations).toLocaleString();

  const summary = document.getElementById("landscapeSummary");
  const greedyHits = Math.round(
    result.greedy.hitRateWhenOptimal * result.discountOptimalTrials,
  );
  const psoHits = Math.round(
    result.pso.hitRateWhenOptimal * result.discountOptimalTrials,
  );
  summary.classList.toggle("is-better", psoHits > greedyHits);
  summary.textContent = `In ${result.discountOptimalTrials}/${result.trials} random setups the rebate was actually worth reaching. Greedy reached it ${greedyHits}/${result.discountOptimalTrials} times; the swarm reached it ${psoHits}/${result.discountOptimalTrials} times, at ${(result.pso.meanEvaluations / result.greedy.meanEvaluations).toFixed(1)}x the evaluation cost.`;
}

export function renderScalingBenchmark(results) {
  const body = document.getElementById("scalingTableBody");
  body.replaceChildren();

  for (const row of results) {
    const tr = document.createElement("tr");
    const cells = [
      row.dimensionCount,
      Math.round(row.greedy.meanEvaluations).toLocaleString(),
      Math.round(row.pso.meanEvaluations).toLocaleString(),
      row.greedy.meanUtility.toFixed(4),
      row.pso.meanUtility.toFixed(4),
      `${row.greedy.meanTimeMs.toFixed(1)} ms`,
      `${row.pso.meanTimeMs.toFixed(1)} ms`,
    ];
    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    tr.classList.toggle(
      "is-crossover",
      row.pso.meanEvaluations < row.greedy.meanEvaluations,
    );
    body.append(tr);
  }

  const crossover = results.find(
    (row) => row.pso.meanEvaluations < row.greedy.meanEvaluations,
  );
  const largest = results[results.length - 1];
  const evaluationRatio =
    largest.greedy.meanEvaluations / largest.pso.meanEvaluations;
  const summary = document.getElementById("scalingSummary");
  summary.classList.toggle("is-better", Boolean(crossover));
  summary.textContent = crossover
    ? `The swarm becomes cheaper than greedy once there are ${crossover.dimensionCount} providers to route across. At ${largest.dimensionCount} providers, greedy needs ${evaluationRatio.toFixed(0)}x as many fitness evaluations as the swarm for essentially the same utility (${largest.greedy.meanUtility.toFixed(4)} vs ${largest.pso.meanUtility.toFixed(4)}).`
    : `Greedy stayed cheaper than the swarm across all provider counts tested (up to ${largest.dimensionCount}).`;
}

export function renderNoiseBenchmark(result) {
  document.getElementById("noiseGreedyMeanGap").textContent =
    result.greedy.meanGap.toFixed(5);
  document.getElementById("noisePsoMeanGap").textContent =
    result.pso.meanGap.toFixed(5);
  document.getElementById("noiseGreedyStddev").textContent =
    result.greedy.stddevGap.toFixed(5);
  document.getElementById("noisePsoStddev").textContent =
    result.pso.stddevGap.toFixed(5);
  document.getElementById("noiseGreedyWorst").textContent =
    result.greedy.worstGap.toFixed(5);
  document.getElementById("noisePsoWorst").textContent =
    result.pso.worstGap.toFixed(5);

  const summary = document.getElementById("noiseSummary");
  const psoMoreConsistent = result.pso.stddevGap < result.greedy.stddevGap;
  summary.classList.toggle("is-better", psoMoreConsistent);
  summary.textContent = `Across ${result.trials} trials, each fitness call saw only ${result.sampleCount} simulated transactions instead of the exact expectation. Greedy's final allocation missed the true optimum by ${result.greedy.meanGap.toFixed(5)} on average (±${result.greedy.stddevGap.toFixed(5)}, worst case ${result.greedy.worstGap.toFixed(5)}); the swarm missed by ${result.pso.meanGap.toFixed(5)} on average (±${result.pso.stddevGap.toFixed(5)}, worst case ${result.pso.worstGap.toFixed(5)}). A single unlucky sample locks greedy onto a move it never revisits; the swarm keeps drawing fresh samples across many particles, so no single bad read sticks.`;
}
