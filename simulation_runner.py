"""
simulation_runner.py — Test scenarios and multi-run statistical aggregation.

Scenarios
---------
1  baseline         Normal operating conditions
2  high_failure     Elevated drone failure rate
3  partition        30-min network split then reconnection
4  scalability      Vary drone count: 10, 20, 30, 50, 75
5  extreme          High packet loss + elevated failure rate
"""

import json
import os
import random
from metrics import aggregate_runs, print_metrics_table
from simulation_engine import SimulationEngine


# ── Scenario definitions ──────────────────────────────────────────────────────

SCENARIOS = {
    "baseline": {
        "num_drones": 20,
        "duration": 3600,
        "failure_rate": 0.003 / 60,   # 0.3% per minute -> per tick
        "packet_loss": 0.08,
        "comm_range": 15.0,
        "description": "Normal conditions: 20 drones, 1-hour sim, 0.3% failure/min",
    },
    "high_failure": {
        "num_drones": 20,
        "duration": 3600,
        "failure_rate": 0.01 / 60,    # 1% per minute
        "packet_loss": 0.05,
        "comm_range": 15.0,
        "description": "High failure rate: 1% per minute",
    },
    "partition": {
        "num_drones": 30,
        "duration": 3600,
        "failure_rate": 0.001 / 60,
        "packet_loss": 0.05,
        "comm_range": 15.0,
        "partition_config": {"start": 0, "end": 1800, "x_split": 50},
        "description": "30 drones: 30-min partition then 30-min reconnection",
    },
    "extreme": {
        "num_drones": 20,
        "duration": 3600,
        "failure_rate": 0.005 / 60,
        "packet_loss": 0.15,
        "comm_range": 15.0,
        "description": "Extreme: 15% packet loss, 0.5% failure/min",
    },
}

SCALABILITY_DRONE_COUNTS = [10, 20, 30, 50, 75]

ALL_ALGORITHMS = ["aerosnap", "epidemic", "spray_wait", "emrt", "prophet", "gossip", "direct"]


# ── SimulationTest ────────────────────────────────────────────────────────────

class SimulationTest:
    """Run a single scenario with one algorithm across multiple random seeds."""

    def __init__(self, scenario_name: str, parameters: dict):
        self.scenario_name = scenario_name
        self.parameters = parameters
        self.results: dict = {}

    def run_algorithm(self, algorithm_name: str, num_runs: int = 10) -> dict:
        all_metrics = []
        for seed in range(num_runs):
            params = {k: v for k, v in self.parameters.items()
                      if k not in ("description",)}
            params["strategy"] = algorithm_name
            params["seed"] = seed
            sim = SimulationEngine(**params)
            m = sim.run()
            all_metrics.append(m)

        agg = aggregate_runs(all_metrics)
        agg["scenario"] = self.scenario_name
        self.results[algorithm_name] = agg
        return agg

    def compare_algorithms(self, algorithms=None, num_runs: int = 10) -> dict:
        if algorithms is None:
            algorithms = ALL_ALGORITHMS
        for algo in algorithms:
            print(f"    [{self.scenario_name}] {algo} ({num_runs} runs)...")
            self.run_algorithm(algo, num_runs)
        return self.results


# ── Scalability test ──────────────────────────────────────────────────────────

class ScalabilityTest:
    """Vary drone count and measure how metrics scale."""

    def run(self, algorithms=None, drone_counts=None, num_runs=5) -> dict:
        if algorithms is None:
            algorithms = ALL_ALGORITHMS
        if drone_counts is None:
            drone_counts = SCALABILITY_DRONE_COUNTS

        results = {}  # algo -> drone_count -> aggregated_metrics
        for algo in algorithms:
            results[algo] = {}
            for n in drone_counts:
                print(f"    [scalability] {algo} n={n} ({num_runs} runs)...")
                run_metrics = []
                for seed in range(num_runs):
                    sim = SimulationEngine(
                        num_drones=n,
                        duration=1800,
                        strategy=algo,
                        failure_rate=0.003 / 60,
                        packet_loss=0.08,
                        comm_range=15.0,
                        seed=seed,
                    )
                    run_metrics.append(sim.run())
                results[algo][n] = aggregate_runs(run_metrics)
        return results


# ── Full evaluation runner ────────────────────────────────────────────────────

def run_full_evaluation(
    num_runs: int = 10,
    algorithms=None,
    scenarios=None,
    output_dir: str = "results",
) -> dict:
    """
    Run all scenarios with all algorithms and persist results to JSON.

    Returns a nested dict: scenario_name -> algo -> aggregated_metrics
    """
    if algorithms is None:
        algorithms = ALL_ALGORITHMS
    if scenarios is None:
        scenarios = list(SCENARIOS.keys())

    os.makedirs(output_dir, exist_ok=True)
    all_results = {}

    for sc_name in scenarios:
        params = SCENARIOS[sc_name]
        print(f"\n-- Scenario: {sc_name} -------------------------------------")
        print(f"   {params['description']}")
        test = SimulationTest(sc_name, params)
        sc_results = test.compare_algorithms(algorithms, num_runs)
        all_results[sc_name] = sc_results

        # Save per-scenario JSON
        path = os.path.join(output_dir, f"scenario_{sc_name}.json")
        with open(path, "w") as f:
            json.dump(_serialisable(sc_results), f, indent=2)
        print(f"   Saved -> {path}")

        # Print table for this scenario
        print_metrics_table(sc_results)

    # Scalability
    print("\n── Scalability test ─────────────────────────────────────────────")
    sc_test = ScalabilityTest()
    scalability_results = sc_test.run(algorithms, num_runs=max(3, num_runs // 3))
    all_results["scalability"] = scalability_results
    path = os.path.join(output_dir, "scalability.json")
    with open(path, "w") as f:
        json.dump(_serialisable(scalability_results), f, indent=2)
    print(f"   Saved -> {path}")

    # Flat CSV summary
    _save_csv_summary(all_results, output_dir)

    return all_results


def _serialisable(obj):
    """Recursively convert sets to lists for JSON serialisation."""
    if isinstance(obj, dict):
        return {k: _serialisable(v) for k, v in obj.items()}
    if isinstance(obj, (set, frozenset)):
        return list(obj)
    if isinstance(obj, list):
        return [_serialisable(i) for i in obj]
    return obj


def _save_csv_summary(all_results: dict, output_dir: str):
    import csv
    path = os.path.join(output_dir, "comparative_metrics.csv")
    rows = []
    for sc_name, sc_data in all_results.items():
        if sc_name == "scalability":
            continue
        for algo, m in sc_data.items():
            row = {"scenario": sc_name, "algorithm": algo}
            for key in ("ddr", "dsr", "avg_delay", "p95_delay",
                        "snapshot_accuracy", "overhead",
                        "avg_energy", "avg_hops", "drones_alive",
                        "messages_exchanged", "ttl_expired", "pruned_packets"):
                row[key] = m.get(key, "")
                row[f"{key}_std"] = m.get(f"{key}_std", "")
            rows.append(row)

    if rows:
        with open(path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        print(f"   CSV saved -> {path}")
