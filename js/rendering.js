export function createDashboardView({
  providers,
  profiles,
  stats,
  events,
  getDecision,
  getRecoveryCandidate,
  getMarketContext,
  getCommitmentStatus,
  getNaiveComparison,
}) {
  function render() {
    renderMetrics();
    renderProviders();
    renderEvents();
    renderDecision();
  }

  function renderMetrics() {
    document.getElementById("metricPayments").textContent = stats.payments;
    document.getElementById("metricDelivered").textContent = stats.delivered;
    document.getElementById("metricFailovers").textContent = stats.failovers;
    document.getElementById("metricRate").textContent = stats.payments
      ? `${Math.round((stats.delivered / stats.payments) * 100)}%`
      : "--";
  }

  function renderProviders() {
    const market = getMarketContext();
    const commitmentStatuses = getCommitmentStatus ? getCommitmentStatus() : [];
    providers.forEach((provider, providerIndex) => {
      const prefix = provider.id;
      const isEligible =
        provider.supportedCountries.includes(market.countryId) &&
        provider.supportedCurrencies.includes(market.currencyId);
      const status = !isEligible
        ? "UNSUPPORTED"
        : provider.injected
          ? "OUTAGE"
          : provider.health < 70
            ? "DEGRADED"
            : provider.health < 90
              ? "RECOVERING"
              : "HEALTHY";
      const card = document.getElementById(`provider-${prefix}`);
      const mapNode = document.getElementById(`mapNode-${prefix}`);
      card.classList.toggle(
        "is-degraded",
        provider.injected || provider.health < 45,
      );
      card.classList.toggle(
        "is-watch",
        !provider.injected && provider.health >= 45 && provider.health < 90,
      );
      card.classList.toggle("is-unavailable", !isEligible);
      mapNode.classList.toggle(
        "is-degraded",
        provider.injected || provider.health < 45,
      );
      mapNode.classList.toggle(
        "is-watch",
        !provider.injected && provider.health >= 45 && provider.health < 90,
      );
      mapNode.classList.toggle("is-unavailable", !isEligible);
      document
        .getElementById(`route-${provider.id}`)
        .classList.toggle("is-unavailable", !isEligible);
      document.getElementById(`${prefix}State`).textContent = status;
      document.getElementById(`${prefix}Health`).textContent = Math.round(
        provider.health,
      );
      document.getElementById(`${prefix}HealthBar`).style.width =
        `${provider.health}%`;
      document.getElementById(`${prefix}Latency`).textContent =
        `${provider.latency} ms`;
      document.getElementById(`${prefix}Success`).textContent =
        provider.successes;
      document.getElementById(`${prefix}Failures`).textContent =
        provider.failures;
      document.getElementById(`${prefix}MapStatus`).textContent = status;
      const controlName = `${prefix[0].toUpperCase()}${prefix.slice(1)}`;
      document.getElementById(`degrade${controlName}`).checked =
        provider.injected;
      document.getElementById(`${prefix}Capabilities`).textContent =
        `${provider.supportedCountries.join(" · ")} / ${provider.supportedCurrencies.join(" · ")}`;

      const commitmentEl = document.getElementById(`${prefix}Commitment`);
      const commitment = commitmentStatuses[providerIndex];
      if (commitmentEl) {
        if (commitment) {
          commitmentEl.textContent = `MIN VOLUME ${Math.round(commitment.minVolumeCommitment * 100)}% · CARRYING ${Math.round(commitment.currentShare * 100)}% · ${commitment.met ? "MET" : "SHORTFALL"}`;
          commitmentEl.classList.toggle("is-breached", !commitment.met);
          commitmentEl.hidden = false;
        } else {
          commitmentEl.hidden = true;
        }
      }
    });
  }

  function renderEvents() {
    const list = document.getElementById("eventList");
    document.getElementById("activityCount").textContent =
      `${events.length} EVENT${events.length === 1 ? "" : "S"}`;
    list.replaceChildren();

    if (events.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-event";
      empty.textContent = "No payment activity yet";
      list.append(empty);
      return;
    }

    for (const event of events) {
      const item = document.createElement("li");
      const mark = document.createElement("span");
      const copy = document.createElement("span");
      const title = document.createElement("span");
      const detail = document.createElement("span");
      const time = document.createElement("time");
      item.className = `is-${event.kind}`;
      mark.className = "event-mark";
      copy.className = "event-copy";
      title.className = "event-title";
      title.textContent = event.title;
      detail.className = "event-detail";
      detail.textContent = event.detail;
      time.className = "event-time";
      time.textContent = event.time;
      copy.append(title, detail);
      item.append(mark, copy, time);
      list.append(item);
    }
  }

  function renderDecision() {
    const decision = getDecision();
    document.getElementById("swarmProfileName").textContent =
      decision.profileName.toUpperCase();
    document.getElementById("transactionProfile").value = decision.profileId;
    const market = getMarketContext();
    document.getElementById("merchantCountry").value = market.countryId;
    document.getElementById("settlementCurrency").value = market.currencyId;
    const allocation = decision.shares
      .map(
        (share, index) =>
          `${providers[index].shortName} ${Math.round(share * 100)}%`,
      )
      .join(" / ");
    const recoveryCandidate = getRecoveryCandidate();
    document.getElementById("routeDecision").textContent =
      `PSO mix: ${allocation}`;
    const nextAction = recoveryCandidate
      ? `Next payment probes ${recoveryCandidate.name}.`
      : "Next payment follows the PSO mix.";
    document.getElementById("decisionDetail").textContent =
      `PSO utility ${decision.fitness.toFixed(2)} · ${decision.profileName} · ${market.countryId}/${market.currencyId} · ${allocation}. ${nextAction}`;
    renderNaiveComparison();
    renderSwarmParticles(decision.particles, decision.shares);
  }

  function renderNaiveComparison() {
    const naiveEl = document.getElementById("naiveComparison");
    if (!naiveEl || !getNaiveComparison) return;
    const { provider, isEligibleHere } = getNaiveComparison();
    naiveEl.textContent = isEligibleHere
      ? `A naive "always use the best single provider" rule would send every payment to ${provider.name}.`
      : `A naive "always use the best single provider" rule would send every payment to ${provider.name} — which doesn't even support this merchant's market.`;
    naiveEl.classList.toggle("is-broken", !isEligibleHere);
  }

  function renderSwarmParticles(particles, shares) {
    const group = document.getElementById("swarmParticles");
    if (!group) return;

    while (group.children.length < particles.length) {
      const particle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      particle.classList.add("swarm-particle");
      particle.setAttribute("r", "3.5");
      group.append(particle);
    }

    const routePoints = providers.map((provider) => {
      const path = document.getElementById(`route-${provider.id}`);
      return path.getPointAtLength(path.getTotalLength() * 0.62);
    });

    particles.forEach((particle, index) => {
      const dot = group.children[index];
      const x = particle.position.reduce(
        (total, share, providerIndex) =>
          total + routePoints[providerIndex].x * share,
        0,
      );
      const y = particle.position.reduce(
        (total, share, providerIndex) =>
          total + routePoints[providerIndex].y * share,
        0,
      );
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", y);
      const isLeader = particle.position.every(
        (share, providerIndex) =>
          Math.abs(share - shares[providerIndex]) < 0.025,
      );
      dot.classList.toggle("is-leader", isLeader);
      dot.setAttribute("r", isLeader ? "4.5" : "3.5");
    });

    renderSwarmChart(particles, shares);
  }

  const SWARM_CHART_AXIS_LEFT = 96;
  const SWARM_CHART_AXIS_RIGHT = 460;
  const SWARM_CHART_ROW_HEIGHT = 46;
  const SWARM_CHART_FIRST_ROW_Y = 34;
  const svgNS = "http://www.w3.org/2000/svg";

  function renderSwarmChart(particles, shares) {
    document.getElementById("swarmAllocation").textContent = shares
      .map(
        (share, index) =>
          `${providers[index].shortName.toUpperCase()} ${Math.round(share * 100)}%`,
      )
      .join(" / ");

    const container = document.getElementById("swarmChartRows");
    if (!container) return;
    const axisSpan = SWARM_CHART_AXIS_RIGHT - SWARM_CHART_AXIS_LEFT;

    while (container.children.length < providers.length) {
      const row = document.createElementNS(svgNS, "g");
      row.classList.add("swarm-chart-row");

      const axis = document.createElementNS(svgNS, "line");
      axis.classList.add("swarm-row-axis");
      axis.setAttribute("x1", SWARM_CHART_AXIS_LEFT);
      axis.setAttribute("x2", SWARM_CHART_AXIS_RIGHT);
      row.append(axis);

      const label = document.createElementNS(svgNS, "text");
      label.classList.add("swarm-row-label");
      label.setAttribute("x", 4);
      row.append(label);

      const readout = document.createElementNS(svgNS, "text");
      readout.classList.add("swarm-row-readout");
      readout.setAttribute("x", SWARM_CHART_AXIS_RIGHT + 14);
      row.append(readout);

      const dots = document.createElementNS(svgNS, "g");
      dots.classList.add("swarm-row-dots");
      row.append(dots);

      const target = document.createElementNS(svgNS, "circle");
      target.classList.add("swarm-target");
      target.setAttribute("r", "8");
      row.append(target);

      container.append(row);
    }

    providers.forEach((provider, providerIndex) => {
      const rowY =
        SWARM_CHART_FIRST_ROW_Y + providerIndex * SWARM_CHART_ROW_HEIGHT;
      const row = container.children[providerIndex];
      const share = shares[providerIndex];

      const axis = row.querySelector(".swarm-row-axis");
      axis.setAttribute("y1", rowY);
      axis.setAttribute("y2", rowY);

      const label = row.querySelector(".swarm-row-label");
      label.setAttribute("y", rowY + 4);
      label.textContent = provider.shortName;

      const readout = row.querySelector(".swarm-row-readout");
      readout.setAttribute("y", rowY + 4);
      readout.textContent = `${Math.round(share * 100)}%`;

      const target = row.querySelector(".swarm-target");
      target.setAttribute("cx", SWARM_CHART_AXIS_LEFT + share * axisSpan);
      target.setAttribute("cy", rowY);

      const dots = row.querySelector(".swarm-row-dots");
      while (dots.children.length < particles.length) {
        const dot = document.createElementNS(svgNS, "circle");
        dot.classList.add("swarm-chart-particle");
        dot.setAttribute("r", "3.5");
        dots.append(dot);
      }

      particles.forEach((particle, particleIndex) => {
        const dot = dots.children[particleIndex];
        const particleShare = particle.position[providerIndex];
        const jitter = ((particleIndex % 7) - 3) * 2.6;
        dot.setAttribute(
          "cx",
          SWARM_CHART_AXIS_LEFT + particleShare * axisSpan,
        );
        dot.setAttribute("cy", rowY + jitter);
        dot.classList.toggle(
          "is-leader",
          particle.position.every(
            (particleProviderShare, otherIndex) =>
              Math.abs(particleProviderShare - shares[otherIndex]) < 0.025,
          ),
        );
      });
    });
  }

  function renderBenchmark(result) {
    renderPolicyResult("baseline", result.baseline);
    renderPolicyResult("greedy", result.greedy);
    renderPolicyResult("pso", result.pso);
    const utilityDelta = result.pso.utility - result.greedy.utility;
    const approvalDelta =
      (result.pso.approvalRate - result.greedy.approvalRate) * 100;
    const evaluationRatio =
      result.pso.fitnessEvaluations / result.greedy.fitnessEvaluations;
    const summary = document.getElementById("benchmarkSummary");
    summary.classList.toggle("is-better", utilityDelta > 0);
    summary.classList.toggle("is-worse", utilityDelta < 0);
    const meanResult =
      Math.abs(utilityDelta) < 0.0005
        ? "mean utility was effectively tied with greedy"
        : `${utilityDelta > 0 ? "mean utility exceeded" : "mean utility trailed"} greedy by ${Math.abs(utilityDelta).toFixed(5)} per request`;
    summary.textContent = `Across ${result.scenarioCount} paired scenarios (${result.requestCount.toLocaleString()} requests per policy), PSO ${meanResult}, won ${result.psoWinsGreedy}/${result.scenarioCount} individual scenarios, and used ${evaluationRatio.toFixed(0)}x as many fitness evaluations. Approval delta versus greedy: ${approvalDelta >= 0 ? "+" : ""}${approvalDelta.toFixed(2)} points.`;
  }

  function renderPolicyResult(prefix, result) {
    document.getElementById(`${prefix}Mix`).textContent = result.shares
      .map((allocation, profileIndex) => {
        const split = allocation
          .map(
            (share, providerIndex) =>
              `${providers[providerIndex].shortName} ${Math.round(share * 100)}%`,
          )
          .join(" / ");
        return `${profiles[profileIndex].shortName}: ${split}`;
      })
      .join(" · ");
    document.getElementById(`${prefix}Approval`).textContent =
      `${(result.approvalRate * 100).toFixed(1)}%`;
    document.getElementById(`${prefix}Latency`).textContent =
      `${Math.round(result.meanLatency)} ms`;
    document.getElementById(`${prefix}Fee`).textContent =
      `${result.meanFeeBps.toFixed(0)} bps`;
    document.getElementById(`${prefix}Utility`).textContent =
      result.utility.toFixed(5);
    document.getElementById(`${prefix}Evaluations`).textContent = Math.round(
      result.fitnessEvaluations,
    ).toLocaleString();
  }

  function setMessage(message, kind = "success") {
    const output = document.getElementById("liveMessage");
    output.textContent = message;
    output.classList.toggle("is-warning", kind === "warning");
    output.classList.toggle("is-error", kind === "error");
  }

  function setBusy(isBusy) {
    for (const id of [
      "sendPayment",
      "sendFailedPayment",
      "resetDemo",
      "runBenchmark",
    ]) {
      document.getElementById(id).disabled = isBusy;
    }
  }

  function clearRouteAnimation() {
    document
      .querySelectorAll(".route-line")
      .forEach((line) => line.classList.remove("is-active", "is-retry"));
    document
      .getElementById("paymentPacket")
      .setAttribute("visibility", "hidden");
  }

  function animatePacket(providerId) {
    const path = document.getElementById(`route-${providerId}`);
    const packet = document.getElementById("paymentPacket");
    document
      .querySelectorAll(".route-line")
      .forEach((line) => line.classList.remove("is-active", "is-retry"));
    path.classList.add("is-active");
    packet.setAttribute("visibility", "visible");

    const pathLength = path.getTotalLength();
    const start = performance.now();
    const duration = 640;

    return new Promise((resolve) => {
      const finish = () => {
        packet.setAttribute("visibility", "hidden");
        resolve();
      };

      if (
        document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        const point = path.getPointAtLength(pathLength);
        packet.setAttribute("cx", point.x);
        packet.setAttribute("cy", point.y);
        finish();
        return;
      }

      function movePacket(now) {
        const progress = Math.min(1, (now - start) / duration);
        const easedProgress =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const point = path.getPointAtLength(pathLength * easedProgress);
        packet.setAttribute("cx", point.x);
        packet.setAttribute("cy", point.y);

        if (progress < 1) {
          requestAnimationFrame(movePacket);
        } else {
          finish();
        }
      }

      requestAnimationFrame(movePacket);
    });
  }

  return {
    animatePacket,
    clearRouteAnimation,
    render,
    renderDecision,
    renderBenchmark,
    setBusy,
    setMessage,
  };
}
