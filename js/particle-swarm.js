export function projectToSimplex(values) {
  const sorted = [...values].sort((first, second) => second - first);
  let cumulative = 0;
  let activeDimensions = 0;

  for (let index = 0; index < sorted.length; index++) {
    cumulative += sorted[index];
    if (sorted[index] - (cumulative - 1) / (index + 1) > 0) {
      activeDimensions = index + 1;
    }
  }

  const threshold =
    (sorted
      .slice(0, activeDimensions)
      .reduce((sum, value) => sum + value, 0) -
      1) /
    activeDimensions;
  return values.map((value) => Math.max(0, value - threshold));
}

export class ProviderRoutingSwarm {
  constructor(
    providerCount,
    particleCount = 20,
    random = Math.random,
    groupCount = 1,
  ) {
    if (providerCount < 2)
      throw new Error("The route swarm requires at least two providers.");
    if (groupCount < 1)
      throw new Error(
        "The route swarm requires at least one allocation group.",
      );

    this.providerCount = providerCount;
    this.particleCount = particleCount;
    this.random = random;
    this.groupCount = groupCount;
    this.dimensionCount = providerCount * groupCount;
    this.reset();
  }

  reset() {
    this.particles = Array.from({ length: this.particleCount }, (_, index) => {
      const position =
        index < this.providerCount
          ? this.oneHotAllocation(index)
          : this.randomAllocation();
      return {
        position,
        velocity: position.map(() => (this.random() - 0.5) * 0.12),
        bestPosition: [...position],
      };
    });
  }

  getBest(objective) {
    const fitnessAt = this.createFitnessFunction(objective);
    let bestPosition = [...this.particles[0].bestPosition];
    let bestFitness = fitnessAt(bestPosition);

    for (const particle of this.particles) {
      const fitness = fitnessAt(particle.bestPosition);
      if (fitness > bestFitness) {
        bestPosition = [...particle.bestPosition];
        bestFitness = fitness;
      }
    }

    return {
      shares: bestPosition,
      chaseShare: bestPosition[1],
      allocations: this.toAllocations(bestPosition),
      fitness: bestFitness,
      particles: this.particles,
    };
  }

  step(objective) {
    const fitnessAt = this.createFitnessFunction(objective);
    for (let index = 0; index < this.providerCount; index++) {
      const particle = this.particles[index];
      particle.position = this.oneHotAllocation(index);
      particle.bestPosition = [...particle.position];
      particle.velocity.fill(0);
    }

    const globalBest = this.getBest(objective);
    for (
      let index = this.providerCount;
      index < this.particles.length;
      index++
    ) {
      const particle = this.particles[index];
      const currentFitness = fitnessAt(particle.position);
      if (currentFitness > fitnessAt(particle.bestPosition))
        particle.bestPosition = [...particle.position];

      const nextPosition = particle.position.map((share, dimension) => {
        const personalPull =
          1.1 * this.random() * (particle.bestPosition[dimension] - share);
        const globalPull =
          1.35 * this.random() * (globalBest.shares[dimension] - share);
        particle.velocity[dimension] = Math.max(
          -0.12,
          Math.min(
            0.12,
            0.72 * particle.velocity[dimension] + personalPull + globalPull,
          ),
        );
        return share + particle.velocity[dimension];
      });
      particle.position = this.projectToGroupedSimplex(nextPosition);

      if (fitnessAt(particle.position) > fitnessAt(particle.bestPosition)) {
        particle.bestPosition = [...particle.position];
      }
    }

    return this.getBest(objective);
  }

  createFitnessFunction(objective) {
    if (typeof objective === "function") return objective;
    if (!Array.isArray(objective) || objective.length !== this.dimensionCount) {
      throw new Error(
        "Provide a fitness function or one utility per allocation dimension.",
      );
    }
    return (shares) =>
      shares.reduce(
        (fitness, share, index) => fitness + share * objective[index],
        0,
      );
  }

  oneHot(index) {
    return Array.from({ length: this.providerCount }, (_, dimension) =>
      dimension === index ? 1 : 0,
    );
  }

  oneHotAllocation(providerIndex) {
    return Array.from({ length: this.groupCount }, () =>
      this.oneHot(providerIndex),
    ).flat();
  }

  randomAllocation() {
    return Array.from({ length: this.groupCount }, () => {
      const weights = Array.from(
        { length: this.providerCount },
        () => -Math.log(Math.max(this.random(), Number.EPSILON)),
      );
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      return weights.map((weight) => weight / total);
    }).flat();
  }

  toAllocations(shares) {
    return Array.from({ length: this.groupCount }, (_, groupIndex) =>
      shares.slice(
        groupIndex * this.providerCount,
        (groupIndex + 1) * this.providerCount,
      ),
    );
  }

  projectToSimplex(values) {
    return projectToSimplex(values);
  }

  projectToGroupedSimplex(values) {
    return this.toAllocations(values)
      .map((group) => this.projectToSimplex(group))
      .flat();
  }
}
