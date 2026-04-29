"""
main.py — Entry point for AeroSnap evaluation.

Usage
-----
# Quick sanity run (5 drones, 300 ticks, all algorithms, 3 seeds)
python main.py --quick

# Full evaluation (20 drones, 3600 ticks, 10 seeds per algo/scenario)
python main.py --full

# Single strategy run with frame export
python main.py --strategy aerosnap --steps 600 --drones 10 --export

# Delivery timeline comparison only
python main.py --timeline
"""

import argparse
import os

from simulation_engine import SimulationEngine
from simulation_runner import run_full_evaluation, ALL_ALGORITHMS
from visualization import (
    plot_metric_comparison,
    plot_delivery_timelines,
    plot_network_snapshot,
    plot_emrt_l_distribution,
    plot_emrt_vs_spray_wait,
    generate_all_plots,
)


def quick_run(steps: int = 600, num_drones: int = 10):
    """Smoke-test: all algorithms, few drones, short duration."""
    print("\n== Quick Run ==================================================")
    results = {}
    timelines = {}
    emrt_l_values = []

    for algo in ALL_ALGORITHMS:
        sim = SimulationEngine(
            num_drones=num_drones,
            duration=steps,
            strategy=algo,
            failure_rate=0.003 / 60,
            packet_loss=0.08,
            comm_range=15.0,
            seed=0,
        )
        m = sim.run()
        results[algo] = m
        timelines[algo] = sim.delivery_timeline
        if algo == "emrt":
            emrt_l_values = sim.metrics.get("emrt_l_values", [])
        print(f"  {algo:<14} DDR={m['ddr']:5.1f}%  DSR={m['dsr']:5.1f}%"
              f"  overhead={m['overhead']:.2f}  snap_acc={m['snapshot_accuracy']:.1f}%")

    os.makedirs("plots", exist_ok=True)
    plot_metric_comparison(results, "plots")
    plot_delivery_timelines(timelines, "plots")
    plot_emrt_l_distribution(emrt_l_values, "plots")
    plot_emrt_vs_spray_wait(results, "plots")

    sim_snap = SimulationEngine(
        num_drones=num_drones, duration=steps, strategy="aerosnap",
        failure_rate=0.003 / 60, packet_loss=0.08, comm_range=15.0, seed=0,
    )
    sim_snap.run()
    plot_network_snapshot(sim_snap, "plots")



def timeline_comparison(steps: int = 3600, num_drones: int = 20):
    """Delivery rate timeline for all algorithms."""
    print("\n== Delivery Timeline ==========================================")
    timelines = {}
    for algo in ALL_ALGORITHMS:
        sim = SimulationEngine(
            num_drones=num_drones,
            duration=steps,
            strategy=algo,
            failure_rate=0.003 / 60,
            packet_loss=0.08,
            comm_range=15.0,
            seed=42,
        )
        sim.run()
        timelines[algo] = sim.delivery_timeline
        print(f"  {algo}: {len(sim.delivery_timeline)} timeline points")
    os.makedirs("plots", exist_ok=True)
    plot_delivery_timelines(timelines, "plots")


def single_strategy(strategy: str, steps: int, num_drones: int, export: bool):
    """Run one strategy and print metrics, optionally exporting trace JSON."""
    print(f"\n== Single Strategy: {strategy.upper()} ====================")
    sim = SimulationEngine(
        num_drones=num_drones,
        duration=steps,
        strategy=strategy,
        failure_rate=0.003 / 60,
        packet_loss=0.08,
        comm_range=15.0,
        seed=42,
    )
    m = sim.run(record_frames=export)
    for k, v in m.items():
        print(f"  {k:<25}: {v}")
    if export:
        os.makedirs("output", exist_ok=True)
        sim.export_json(f"output/{strategy}_trace.json")
    os.makedirs("plots", exist_ok=True)
    plot_network_snapshot(sim, "plots")
    if strategy == "emrt":
        plot_emrt_l_distribution(sim.metrics.get("emrt_l_values", []), "plots")


def full_run(num_runs: int = 10):
    """Complete evaluation: all scenarios x all algorithms."""
    print("\n== Full Evaluation ============================================")
    all_results = run_full_evaluation(
        num_runs=num_runs,
        algorithms=ALL_ALGORITHMS,
        output_dir="results",
    )
    generate_all_plots(all_results, save_dir="plots")


def main():
    parser = argparse.ArgumentParser(description="AeroSnap Simulation")
    parser.add_argument("--quick", action="store_true",
                        help="Quick smoke test (small scale)")
    parser.add_argument("--full", action="store_true",
                        help="Full evaluation (all scenarios x algorithms)")
    parser.add_argument("--timeline", action="store_true",
                        help="Delivery timeline comparison only")
    parser.add_argument("--strategy", default=None,
                        help="Run single strategy (aerosnap/epidemic/emrt/...)")
    parser.add_argument("--steps", type=int, default=3600,
                        help="Simulation duration in ticks")
    parser.add_argument("--drones", type=int, default=20,
                        help="Number of drones")
    parser.add_argument("--runs", type=int, default=10,
                        help="Runs per algorithm (for --full)")
    parser.add_argument("--export", action="store_true",
                        help="Export frame trace JSON")
    args = parser.parse_args()

    if args.quick:
        quick_run(steps=min(args.steps, 600), num_drones=args.drones)
    elif args.full:
        full_run(num_runs=args.runs)
    elif args.timeline:
        timeline_comparison(steps=args.steps, num_drones=args.drones)
    elif args.strategy:
        single_strategy(args.strategy, args.steps, args.drones, args.export)
    else:
        quick_run(steps=600, num_drones=10)


if __name__ == "__main__":
    main()
