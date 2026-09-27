import { ProviderRoutingSwarm } from "./particle-swarm.js";
import { createDashboardView } from "./rendering.js";

const MAX_PAYMENT_ATTEMPTS = 5;
const SWARM_ANIMATION_FRAMES = 18;
const BENCHMARK_REQUESTS = 1200;
const BENCHMARK_SCENARIOS = 10;

export function createPaymentFlow() {
  const providers = [
    {
      id: "adyen",
      name: "Adyen API",
      shortName: "Adyen",
      homeCountry: "NL",
      supportedCountries: ["US", "GB", "DE"],
      supportedCurrencies: ["USD", "GBP", "EUR"],
      feeBpsByCurrency: { USD: 238, GBP: 252, EUR: 246 },
      crossBorderFeeBps: 12,
      crossBorderLatency: 14,
      baseLatency: 148,
      baseApprovalRate: 0.992,
      capacityShare: 0.45,
      minVolumeCommitment: 0.45,
      commitmentPenaltyWeight: 1.5,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 148,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
    {
      id: "chase",
      name: "Chase EU",
      shortName: "Chase",
      homeCountry: "GB",
      supportedCountries: ["GB", "DE"],
      supportedCurrencies: ["GBP", "EUR"],
      feeBpsByCurrency: { GBP: 208, EUR: 204 },
      crossBorderFeeBps: 16,
      crossBorderLatency: 22,
      baseLatency: 196,
      baseApprovalRate: 0.988,
      capacityShare: 0.4,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 196,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
    {
      id: "worldpay",
      name: "Worldpay EU",
      shortName: "Worldpay",
      homeCountry: "GB",
      supportedCountries: ["GB", "DE"],
      supportedCurrencies: ["GBP", "EUR"],
      feeBpsByCurrency: { GBP: 215, EUR: 210 },
      crossBorderFeeBps: 18,
      crossBorderLatency: 20,
      baseLatency: 175,
      baseApprovalRate: 0.985,
      capacityShare: 0.35,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 175,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
    {
      id: "stripe",
      name: "Stripe API",
      shortName: "Stripe",
      homeCountry: "US",
      supportedCountries: ["US", "GB", "DE"],
      supportedCurrencies: ["USD", "GBP", "EUR"],
      feeBpsByCurrency: { USD: 251, GBP: 267, EUR: 259 },
      crossBorderFeeBps: 14,
      crossBorderLatency: 18,
      baseLatency: 145,
      baseApprovalRate: 0.987,
      capacityShare: 0.58,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 145,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
    {
      id: "braintree",
      name: "Braintree API",
      shortName: "Braintree",
      homeCountry: "US",
      supportedCountries: ["US", "GB", "DE"],
      supportedCurrencies: ["USD", "GBP", "EUR"],
      feeBpsByCurrency: { USD: 245, GBP: 260, EUR: 252 },
      crossBorderFeeBps: 13,
      crossBorderLatency: 16,
      baseLatency: 160,
      baseApprovalRate: 0.99,
      capacityShare: 0.5,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 160,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
  ];

  const profiles = [
    {
      id: "standard",
      label: "Standard",
      shortName: "Std",
      trafficShare: 0.55,
      failurePenalty: 3,
      latencyWeight: 1,
      feeWeight: 0.8,
    },
    {
      id: "priority",
      label: "Priority",
      shortName: "Priority",
      trafficShare: 0.25,
      failurePenalty: 8,
      latencyWeight: 1.6,
      feeWeight: 0.35,
    },
    {
      id: "feeSensitive",
      label: "Fee-sensitive",
      shortName: "Low fee",
      trafficShare: 0.2,
      failurePenalty: 3,
      latencyWeight: 0.35,
      feeWeight: 2.5,
    },
  ];

  const merchantCountries = [
    { id: "US", label: "United States", trafficShare: 0.48 },
    { id: "GB", label: "United Kingdom", trafficShare: 0.27 },
    { id: "DE", label: "Germany", trafficShare: 0.25 },
  ];
  const settlementCurrencies = [
    { id: "USD", label: "US dollar", trafficShare: 0.52 },
    { id: "GBP", label: "Pound sterling", trafficShare: 0.22 },
    { id: "EUR", label: "Euro", trafficShare: 0.26 },
  ];

  const profileSwarms = profiles.map(
    () => new ProviderRoutingSwarm(providers.length),
  );
  let profileAllocations = profiles.map(() =>
    providers.map(() => 1 / providers.length),
  );
  let selectedProfileId = profiles[0].id;
  let selectedCountryId = merchantCountries[0].id;
  let selectedCurrencyId = settlementCurrencies[0].id;
  const stats = { payments: 0, delivered: 0, failovers: 0 };
  const events = [];
  let nextPaymentId = 1;
  let processing = false;
  let swarmAnimationId = 0;

  const view = createDashboardView({
    providers,
    profiles,
    stats,
    events,
    getDecision: getSelectedProfileDecision,
    getRecoveryCandidate: () =>
      findRecoveryCandidate(
        nextPaymentId,
        selectedCountryId,
        selectedCurrencyId,
      ),
    getMarketContext: () => ({
      countryId: selectedCountryId,
      currencyId: selectedCurrencyId,
    }),
    providerUtility,
    getCommitmentStatus,
    getNaiveComparison,
    setProviderConfig,
  });

  const DEFAULT_COMMITMENT_PENALTY_WEIGHT = 1.5;

  function setProviderConfig(providerId, field, value) {
    const provider = getProvider(providerId);
    if (!provider) return;
    switch (field) {
      case "feeAdjustmentBps":
        provider.feeAdjustmentBps = value;
        break;
      case "latencyAdjustmentMs":
        provider.latencyAdjustmentMs = value;
        break;
      case "baseApprovalRate":
        provider.baseApprovalRate = value;
        break;
      case "capacityShare":
        provider.capacityShare = Math.max(0.05, value);
        break;
      case "minVolumeCommitment":
        provider.minVolumeCommitment = value > 0 ? value : 0;
        if (value > 0 && !provider.commitmentPenaltyWeight) {
          provider.commitmentPenaltyWeight = DEFAULT_COMMITMENT_PENALTY_WEIGHT;
        }
        break;
      default:
        return;
    }
    view.render();
  }

  function getBestSingleProvider() {
    let bestProviderIndex = 0;
    let bestFitness = -Infinity;
    for (
      let providerIndex = 0;
      providerIndex < providers.length;
      providerIndex++
    ) {
      const allocations = profiles.map(() =>
        providers.map((_, index) => Number(index === providerIndex)),
      );
      const fitness = allocationUtility(allocations, true);
      if (fitness > bestFitness) {
        bestFitness = fitness;
        bestProviderIndex = providerIndex;
      }
    }
    return providers[bestProviderIndex];
  }

  function getNaiveComparison() {
    const provider = getBestSingleProvider();
    return {
      provider,
      isEligibleHere: providerSupports(
        provider,
        selectedCountryId,
        selectedCurrencyId,
      ),
    };
  }

  function getCommitmentStatus() {
    const providerLoadShares = getProviderLoadShares(profileAllocations);
    return providers.map((provider, index) =>
      provider.minVolumeCommitment
        ? {
            minVolumeCommitment: provider.minVolumeCommitment,
            currentShare: providerLoadShares[index],
            // Compare at the same rounded precision the badge displays, so
            // the label never contradicts the percentage shown next to it.
            met:
              Math.round(providerLoadShares[index] * 100) >=
              Math.round(provider.minVolumeCommitment * 100),
          }
        : null,
    );
  }

  function getProvider(id) {
    return providers.find((provider) => provider.id === id);
  }

  function setInjectedOutage(providerId, isInjected) {
    const provider = getProvider(providerId);
    provider.injected = isInjected;
    addEvent(
      `${provider.name} outage ${isInjected ? "injected" : "cleared"}`,
      isInjected
        ? "Authorization requests will time out."
        : "Provider is accepting authorization requests again.",
      isInjected ? "fail" : "success",
    );
    view.setMessage(
      isInjected
        ? `${provider.name} marked unavailable`
        : `${provider.name} restored`,
      isInjected ? "warning" : "success",
    );
    view.render();
  }

  function chooseProvider(
    paymentId,
    profile,
    countryId,
    currencyId,
    allowRecoveryProbe = false,
  ) {
    const swarmDecision = optimizeRoute();
    const profileIndex = profiles.indexOf(profile);
    const profileShares = filterEligibleShares(
      swarmDecision.allocations[profileIndex],
      countryId,
      currencyId,
    );
    const providerLoadShares = getProviderLoadShares(swarmDecision.allocations);
    const recoveryCandidate = allowRecoveryProbe
      ? findRecoveryCandidate(paymentId, countryId, currencyId)
      : null;
    if (recoveryCandidate) {
      const providerIndex = providers.indexOf(recoveryCandidate);
      return {
        provider: recoveryCandidate,
        isRecoveryProbe: true,
        allocationShare: providerLoadShares[providerIndex],
      };
    }

    const draw = Math.random();
    let cumulativeShare = 0;
    for (let index = 0; index < providers.length; index++) {
      cumulativeShare += profileShares[index];
      if (draw <= cumulativeShare || index === providers.length - 1) {
        return {
          provider: providers[index],
          isRecoveryProbe: false,
          allocationShare: providerLoadShares[index],
        };
      }
    }
  }

  function findRecoveryCandidate(paymentId, countryId, currencyId) {
    if (!paymentId || paymentId % 3 !== 0) return null;
    return (
      providers
        .filter(
          (provider) =>
            providerSupports(provider, countryId, currencyId) &&
            !provider.injected &&
            provider.health < 95,
        )
        .sort((first, second) => first.health - second.health)[0] ?? null
    );
  }

  function providerSupports(provider, countryId, currencyId) {
    return (
      provider.supportedCountries.includes(countryId) &&
      provider.supportedCurrencies.includes(currencyId)
    );
  }

  function filterEligibleShares(shares, countryId, currencyId) {
    const eligibleShares = shares.map((share, index) =>
      providerSupports(providers[index], countryId, currencyId) ? share : 0,
    );
    const total = eligibleShares.reduce((sum, share) => sum + share, 0);
    if (total > 0) return eligibleShares.map((share) => share / total);

    const eligibleCount = providers.filter((provider) =>
      providerSupports(provider, countryId, currencyId),
    ).length;
    return eligibleShares.map((share, index) =>
      providerSupports(providers[index], countryId, currencyId)
        ? 1 / eligibleCount
        : 0,
    );
  }

  function getProviderFeeBps(provider, countryId, currencyId) {
    return (
      provider.feeBpsByCurrency[currencyId] +
      (provider.homeCountry === countryId ? 0 : provider.crossBorderFeeBps) +
      (provider.feeAdjustmentBps || 0)
    );
  }

  function providerPerformance(
    provider,
    providerLoadShare,
    countryId,
    useBaseModel = false,
  ) {
    const observedApprovalRate = useBaseModel
      ? provider.baseApprovalRate
      : Math.min(provider.baseApprovalRate, provider.health / 100);
    const utilization = providerLoadShare / provider.capacityShare;
    const congestion = Math.max(0, utilization - 0.72);
    return {
      approvalProbability:
        provider.injected && !useBaseModel
          ? 0
          : Math.max(0.4, observedApprovalRate - congestion * 0.17),
      meanLatency:
        (useBaseModel ? provider.baseLatency : provider.latency) +
        (provider.latencyAdjustmentMs || 0) +
        650 * congestion ** 2 +
        (provider.homeCountry === countryId ? 0 : provider.crossBorderLatency),
    };
  }

  function providerUtility(
    provider,
    providerLoadShare,
    profile,
    countryId,
    currencyId,
    useBaseModel = false,
  ) {
    const performance = providerPerformance(
      provider,
      providerLoadShare,
      countryId,
      useBaseModel,
    );
    const expectedFailureCost =
      (1 - performance.approvalProbability) * profile.failurePenalty;
    const latencyCost =
      (performance.meanLatency / 3500) * profile.latencyWeight;
    const feeCost =
      (getProviderFeeBps(provider, countryId, currencyId) / 10000) *
      profile.feeWeight;
    return (
      performance.approvalProbability -
      expectedFailureCost -
      latencyCost -
      feeCost
    );
  }

  function getProviderLoadShares(allocations) {
    const loads = providers.map(() => 0);
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      const profile = profiles[profileIndex];
      for (const country of merchantCountries) {
        for (const currency of settlementCurrencies) {
          const weight =
            profile.trafficShare * country.trafficShare * currency.trafficShare;
          const shares = filterEligibleShares(
            allocations[profileIndex],
            country.id,
            currency.id,
          );
          for (
            let providerIndex = 0;
            providerIndex < providers.length;
            providerIndex++
          ) {
            loads[providerIndex] += weight * shares[providerIndex];
          }
        }
      }
    }
    return loads;
  }

  function allocationUtility(value, useBaseModel = false) {
    const allocations = Array.isArray(value[0])
      ? value
      : value.length === providers.length
        ? profiles.map(() => value)
        : profiles.map((_, profileIndex) =>
            value.slice(
              profileIndex * providers.length,
              (profileIndex + 1) * providers.length,
            ),
          );
    const providerLoadShares = getProviderLoadShares(allocations);

    let totalUtility = 0;
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      const profile = profiles[profileIndex];
      for (const country of merchantCountries) {
        for (const currency of settlementCurrencies) {
          const contextWeight =
            profile.trafficShare * country.trafficShare * currency.trafficShare;
          const shares = filterEligibleShares(
            allocations[profileIndex],
            country.id,
            currency.id,
          );
          for (
            let providerIndex = 0;
            providerIndex < providers.length;
            providerIndex++
          ) {
            const share = shares[providerIndex];
            if (!share) continue;
            totalUtility +=
              contextWeight *
              share *
              providerUtility(
                providers[providerIndex],
                providerLoadShares[providerIndex],
                profile,
                country.id,
                currency.id,
                useBaseModel,
              );
          }
        }
      }
    }

    for (const provider of providers) {
      if (!provider.minVolumeCommitment) continue;
      const providerIndex = providers.indexOf(provider);
      const shortfall = Math.max(
        0,
        provider.minVolumeCommitment - providerLoadShares[providerIndex],
      );
      totalUtility -= shortfall * provider.commitmentPenaltyWeight;
    }

    return totalUtility;
  }

  function optimizeRoute() {
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      const fitness = (shares) => {
        const candidate = profileAllocations.map((allocation) => [
          ...allocation,
        ]);
        candidate[profileIndex] = shares;
        return allocationUtility(candidate);
      };
      profileAllocations[profileIndex] = [
        ...profileSwarms[profileIndex].getBest(fitness).shares,
      ];
    }

    return {
      allocations: profileAllocations.map((allocation) => [...allocation]),
      fitness: allocationUtility(profileAllocations),
    };
  }

  function getSelectedProfileDecision() {
    const decision = optimizeRoute();
    const profileIndex = profiles.findIndex(
      (profile) => profile.id === selectedProfileId,
    );
    return {
      ...decision,
      profileId: profiles[profileIndex].id,
      profileName: profiles[profileIndex].label,
      marketLabel: `${selectedCountryId} / ${selectedCurrencyId}`,
      shares: filterEligibleShares(
        decision.allocations[profileIndex],
        selectedCountryId,
        selectedCurrencyId,
      ),
      particles: profileSwarms[profileIndex].particles.map((particle) => ({
        position: filterEligibleShares(
          particle.position,
          selectedCountryId,
          selectedCurrencyId,
        ),
      })),
    };
  }

  function setProfile(profileId) {
    if (!profiles.some((profile) => profile.id === profileId)) return;
    selectedProfileId = profileId;
    view.renderDecision();
    view.setMessage(
      `Payment profile: ${profiles.find((profile) => profile.id === profileId).label}`,
    );
  }

  function setMarketContext(countryId, currencyId) {
    if (
      !merchantCountries.some((country) => country.id === countryId) ||
      !settlementCurrencies.some((currency) => currency.id === currencyId)
    )
      return;
    selectedCountryId = countryId;
    selectedCurrencyId = currencyId;
    view.render();
    view.setMessage(`Merchant route: ${countryId} · ${currencyId}`);
  }

  async function processPayment(forceInitialFailure = false) {
    if (processing) return;
    processing = true;
    view.setBusy(true);

    const paymentId = nextPaymentId++;
    const profile = profiles.find(
      (candidate) => candidate.id === selectedProfileId,
    );
    const naiveProvider = getBestSingleProvider();
    const attemptHistory = [];
    let successfulProvider = null;
    let successfulRecoveryProbe = false;

    for (
      let attemptNumber = 1;
      attemptNumber <= MAX_PAYMENT_ATTEMPTS;
      attemptNumber++
    ) {
      const isInitialAttempt = attemptNumber === 1;
      const { provider, isRecoveryProbe, allocationShare } = chooseProvider(
        paymentId,
        profile,
        selectedCountryId,
        selectedCurrencyId,
        isInitialAttempt && !forceInitialFailure,
      );
      const result = await attemptProvider(
        provider,
        paymentId,
        isRecoveryProbe,
        isInitialAttempt && forceInitialFailure,
        allocationShare,
        profile,
        selectedCountryId,
        selectedCurrencyId,
      );
      attemptHistory.push(
        `${provider.name} ${result.reason} (${result.latency} ms)`,
      );
      view.render();
      view.setMessage(
        result.ok
          ? `${provider.name} authorized · updating route fitness`
          : `${provider.name} failed · swarm recalculating`,
        result.ok ? "success" : "warning",
      );
      await animateSwarm(SWARM_ANIMATION_FRAMES);

      if (result.ok) {
        successfulProvider = provider;
        successfulRecoveryProbe = isRecoveryProbe;
        break;
      }
    }

    stats.payments += 1;
    if (successfulProvider) {
      stats.delivered += 1;
      if (attemptHistory.length > 1) stats.failovers += 1;
      const naiveNote =
        successfulProvider.id !== naiveProvider.id
          ? ` · naive single-provider rule would have used ${naiveProvider.name}`
          : "";
      addEvent(
        successfulRecoveryProbe
          ? `${successfulProvider.name} recovery confirmed`
          : `Payment #${formatId(paymentId)} · ${profile.label} ${attemptHistory.length > 1 ? "recovered" : "authorized"}`,
        `${attemptHistory.join(" → ")}${naiveNote}`,
        attemptHistory.length > 1 ? "retry" : "success",
      );
      view.setMessage(
        successfulRecoveryProbe
          ? `${successfulProvider.name} recovery confirmed`
          : `Payment delivered by ${successfulProvider.name}`,
        attemptHistory.length > 1 ? "warning" : "success",
      );
    } else {
      addEvent(
        `Payment #${formatId(paymentId)} declined after ${attemptHistory.length} attempts`,
        attemptHistory.join(" → "),
        "fail",
      );
      view.setMessage(
        `Payment declined after ${attemptHistory.length} attempts`,
        "error",
      );
    }

    processing = false;
    view.setBusy(false);
    view.render();
  }

  function animateSwarm(iterations) {
    return new Promise((resolve) => {
      const animationId = ++swarmAnimationId;
      const frameCount =
        document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 1
          : iterations;
      let frame = 0;

      function advance() {
        if (animationId !== swarmAnimationId) {
          resolve();
          return;
        }

        stepProfileSwarms();
        view.renderDecision();
        frame += 1;
        if (frame < frameCount) {
          requestAnimationFrame(advance);
        } else {
          resolve();
        }
      }

      if (frameCount === 1) {
        stepProfileSwarms();
        view.renderDecision();
        resolve();
        return;
      }

      requestAnimationFrame(advance);
    });
  }

  function stepProfileSwarms() {
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      const fitness = (shares) => {
        const candidate = profileAllocations.map((allocation) => [
          ...allocation,
        ]);
        candidate[profileIndex] = shares;
        return allocationUtility(candidate);
      };
      profileAllocations[profileIndex] = [
        ...profileSwarms[profileIndex].step(fitness).shares,
      ];
    }
  }

  async function attemptProvider(
    provider,
    paymentId,
    isRecoveryProbe = false,
    forceFailure = false,
    allocationShare = 1 / providers.length,
    profile = profiles[0],
    countryId = selectedCountryId,
    currencyId = selectedCurrencyId,
  ) {
    const isInjectedFailure = provider.injected;
    const performance = providerPerformance(
      provider,
      allocationShare,
      countryId,
    );
    const failed =
      forceFailure ||
      isInjectedFailure ||
      Math.random() >= performance.approvalProbability;
    const latency = Math.round(
      performance.meanLatency +
        (isInjectedFailure ? 900 + Math.random() * 280 : Math.random() * 54),
    );

    view.setMessage(
      `Payment #${formatId(paymentId)} · ${profile.label} · ${countryId}/${currencyId} attempting ${provider.name}…`,
    );
    await view.animatePacket(provider.id);

    provider.attempts += 1;
    if (failed) {
      provider.failures += 1;
      provider.health = Math.round(provider.health * 0.58);
      provider.latency = Math.min(
        1200,
        Math.round(provider.latency * 0.65 + latency * 0.35),
      );
    } else {
      provider.successes += 1;
      const recoveryWeight = isRecoveryProbe ? 0.62 : 0.12;
      provider.health = Math.min(
        100,
        Math.round(provider.health + (100 - provider.health) * recoveryWeight),
      );
      provider.latency = Math.round(
        provider.latency * (isRecoveryProbe ? 0.25 : 0.7) +
          latency * (isRecoveryProbe ? 0.75 : 0.3),
      );
    }

    const reason = !failed
      ? "authorized"
      : isInjectedFailure
        ? "timed out"
        : forceFailure
          ? "simulated failure"
          : "declined";
    return {
      ok: !failed,
      latency,
      reason,
      feeBps: getProviderFeeBps(provider, countryId, currencyId),
    };
  }

  function addEvent(title, detail, kind) {
    events.unshift({
      title,
      detail,
      kind,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    });
    events.length = Math.min(events.length, 6);
  }

  function runBenchmark() {
    if (processing) return;
    view.setBusy(true);

    const baselineTrials = [];
    const greedyTrials = [];
    const psoTrials = [];
    let psoWinsGreedy = 0;
    let psoWinsSingle = 0;

    for (let scenario = 0; scenario < BENCHMARK_SCENARIOS; scenario++) {
      const benchmarkSwarms = profiles.map(
        (_, profileIndex) =>
          new ProviderRoutingSwarm(
            providers.length,
            36,
            createSeededRandom(
              8171 + scenario * 104729 + profileIndex * 15485863,
            ),
          ),
      );
      let psoAllocations = profiles.map(() =>
        providers.map(() => 1 / providers.length),
      );
      let psoFitnessEvaluations = 0;
      for (let iteration = 0; iteration < 180; iteration++) {
        for (
          let profileIndex = 0;
          profileIndex < profiles.length;
          profileIndex++
        ) {
          const fitness = (shares) => {
            const candidate = psoAllocations.map((allocation) => [
              ...allocation,
            ]);
            candidate[profileIndex] = shares;
            psoFitnessEvaluations++;
            return allocationUtility(candidate, true);
          };
          psoAllocations[profileIndex] = [
            ...benchmarkSwarms[profileIndex].step(fitness).shares,
          ];
        }
      }

      let baselineAllocations = profiles.map(() => providers.map(() => 0));
      let baselineFitness = -Infinity;
      let baselineFitnessEvaluations = 0;
      for (
        let providerIndex = 0;
        providerIndex < providers.length;
        providerIndex++
      ) {
        const allocations = profiles.map(() =>
          providers.map((_, index) => Number(index === providerIndex)),
        );
        const candidateFitness = allocationUtility(allocations, true);
        baselineFitnessEvaluations++;
        if (candidateFitness > baselineFitness) {
          baselineFitness = candidateFitness;
          baselineAllocations = allocations;
        }
      }

      const workload = createBenchmarkWorkload(20260926 + scenario * 7919);
      const greedy = greedyAllocation(100);
      const baselineResult = simulatePolicy(
        baselineAllocations,
        workload,
        baselineFitnessEvaluations,
      );
      const greedyResult = simulatePolicy(
        greedy.allocations,
        workload,
        greedy.fitnessEvaluations,
      );
      const psoResult = simulatePolicy(
        psoAllocations,
        workload,
        psoFitnessEvaluations,
      );
      baselineTrials.push(baselineResult);
      greedyTrials.push(greedyResult);
      psoTrials.push(psoResult);
      if (psoResult.utility > greedyResult.utility) psoWinsGreedy++;
      if (psoResult.utility > baselineResult.utility) psoWinsSingle++;
    }

    view.renderBenchmark({
      baseline: averagePolicyResults(baselineTrials),
      greedy: averagePolicyResults(greedyTrials),
      pso: averagePolicyResults(psoTrials),
      scenarioCount: BENCHMARK_SCENARIOS,
      psoWinsGreedy,
      psoWinsSingle,
      requestCount: BENCHMARK_REQUESTS * BENCHMARK_SCENARIOS,
    });
    view.setBusy(false);
    view.setMessage(
      `Benchmark complete · PSO beat greedy in ${psoWinsGreedy}/${BENCHMARK_SCENARIOS} scenarios`,
    );
  }

  function greedyAllocation(steps) {
    const allocations = profiles.map(() =>
      providers.map(() => 1 / providers.length),
    );
    const increment = 1 / steps;
    let fitnessEvaluations = 1;
    let currentFitness = allocationUtility(allocations, true);

    for (let move = 0; move < steps * profiles.length; move++) {
      let bestMove = null;
      let bestFitness = -Infinity;
      for (
        let profileIndex = 0;
        profileIndex < profiles.length;
        profileIndex++
      ) {
        for (let from = 0; from < providers.length; from++) {
          if (allocations[profileIndex][from] < increment) continue;
          for (let to = 0; to < providers.length; to++) {
            if (from === to) continue;
            const candidate = allocations.map((allocation) => [...allocation]);
            candidate[profileIndex][from] -= increment;
            candidate[profileIndex][to] += increment;
            const candidateFitness = allocationUtility(candidate, true);
            fitnessEvaluations++;
            if (candidateFitness > bestFitness + 1e-10) {
              bestFitness = candidateFitness;
              bestMove = { profileIndex, from, to };
            }
          }
        }
      }
      if (!bestMove) break;
      allocations[bestMove.profileIndex][bestMove.from] -= increment;
      allocations[bestMove.profileIndex][bestMove.to] += increment;
      currentFitness = bestFitness;
    }

    return { allocations, fitness: currentFitness, fitnessEvaluations };
  }

  function createSeededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function createBenchmarkWorkload(seed) {
    const random = createSeededRandom(seed);
    const drawWeighted = (values, weightKey) => {
      const draw = random();
      let cumulative = 0;
      for (const value of values) {
        cumulative += value[weightKey];
        if (draw <= cumulative) return value;
      }
      return values[values.length - 1];
    };

    return Array.from({ length: BENCHMARK_REQUESTS }, () => {
      const profileDraw = random();
      let cumulativeShare = 0;
      let profileIndex = profiles.length - 1;
      for (let index = 0; index < profiles.length; index++) {
        cumulativeShare += profiles[index].trafficShare;
        if (profileDraw <= cumulativeShare) {
          profileIndex = index;
          break;
        }
      }
      const country = drawWeighted(merchantCountries, "trafficShare");
      const currency = drawWeighted(settlementCurrencies, "trafficShare");
      return {
        profileIndex,
        countryId: country.id,
        currencyId: currency.id,
        routeDraw: random(),
        approvalRolls: providers.map(random),
        latencyFactors: providers.map(() => 0.9 + random() * 0.2),
      };
    });
  }

  function averagePolicyResults(results) {
    const average = (selector) =>
      results.reduce((total, result) => total + selector(result), 0) /
      results.length;
    return {
      shares: profiles.map((_, profileIndex) =>
        providers.map((_, providerIndex) =>
          average((result) => result.allocations[profileIndex][providerIndex]),
        ),
      ),
      approvalRate: average((result) => result.approvalRate),
      meanLatency: average((result) => result.meanLatency),
      meanFeeBps: average((result) => result.meanFeeBps),
      utility: average((result) => result.utility),
      fitnessEvaluations: average((result) => result.fitnessEvaluations),
    };
  }

  function simulatePolicy(allocations, workload, fitnessEvaluations) {
    let approvals = 0;
    let latencyTotal = 0;
    let feeTotal = 0;
    let utilityTotal = 0;
    const providerLoadShares = getProviderLoadShares(allocations);

    for (const request of workload) {
      let cumulativeShare = 0;
      let providerIndex = providers.length - 1;
      const profile = profiles[request.profileIndex];
      const profileAllocation = filterEligibleShares(
        allocations[request.profileIndex],
        request.countryId,
        request.currencyId,
      );
      for (let index = 0; index < profileAllocation.length; index++) {
        cumulativeShare += profileAllocation[index];
        if (request.routeDraw <= cumulativeShare) {
          providerIndex = index;
          break;
        }
      }

      const provider = providers[providerIndex];
      const performance = providerPerformance(
        provider,
        providerLoadShares[providerIndex],
        request.countryId,
        true,
      );
      const approved =
        request.approvalRolls[providerIndex] < performance.approvalProbability;
      const latency =
        performance.meanLatency * request.latencyFactors[providerIndex];
      const feeBps = getProviderFeeBps(
        provider,
        request.countryId,
        request.currencyId,
      );
      const feeCost = (feeBps / 10000) * profile.feeWeight;

      approvals += Number(approved);
      latencyTotal += latency;
      feeTotal += feeBps;
      utilityTotal +=
        (approved ? 1 : -profile.failurePenalty) -
        (latency / 3500) * profile.latencyWeight -
        feeCost;
    }

    let commitmentPenalty = 0;
    for (const provider of providers) {
      if (!provider.minVolumeCommitment) continue;
      const providerIndex = providers.indexOf(provider);
      const shortfall = Math.max(
        0,
        provider.minVolumeCommitment - providerLoadShares[providerIndex],
      );
      commitmentPenalty += shortfall * provider.commitmentPenaltyWeight;
    }

    return {
      allocations,
      approvalRate: approvals / workload.length,
      meanLatency: latencyTotal / workload.length,
      meanFeeBps: feeTotal / workload.length,
      utility: utilityTotal / workload.length - commitmentPenalty,
      fitnessEvaluations,
    };
  }

  function reset() {
    if (processing) return false;
    profileSwarms.forEach((swarm) => swarm.reset());
    profileAllocations = profiles.map(() =>
      providers.map(() => 1 / providers.length),
    );
    selectedProfileId = profiles[0].id;
    selectedCountryId = merchantCountries[0].id;
    selectedCurrencyId = settlementCurrencies[0].id;
    for (const provider of providers) {
      provider.latency = provider.baseLatency;
      provider.health = 99;
      provider.attempts = 0;
      provider.successes = 0;
      provider.failures = 0;
      provider.injected = false;
    }
    stats.payments = 0;
    stats.delivered = 0;
    stats.failovers = 0;
    nextPaymentId = 1;
    events.length = 0;
    view.clearRouteAnimation();
    view.setMessage("Simulation reset");
    view.render();
    void animateSwarm(SWARM_ANIMATION_FRAMES);
    return true;
  }

  function start() {
    view.render();
    void animateSwarm(SWARM_ANIMATION_FRAMES);
  }

  function formatId(paymentId) {
    return String(paymentId).padStart(3, "0");
  }

  return {
    processPayment,
    reset,
    setProfile,
    setMarketContext,
    runBenchmark,
    setInjectedOutage,
    setProviderConfig,
    setMessage: view.setMessage,
    start,
  };
}
