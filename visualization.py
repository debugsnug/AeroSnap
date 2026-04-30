"""
visualization.py — Matplotlib plots for AeroSnap comparative evaluation.

All functions accept the result dicts produced by simulation_runner.py and
write PNG files to the specified output directory.
"""

import os

ALGO_COLORS = {
    "aerosnap":   "#8B5CF6",
    "epidemic":   "#3B82F6",
    "spray_wait": "#10B981",
    "emrt":       "#F97316",
    "prophet":    "#F59E0B",
    "gossip":     "#EF4444",
    "direct":     "#6B7280",
    "basic":      "#9CA3AF",
}

ALGO_LABELS = {
    "aerosnap":   "AeroSnap",
    "epidemic":   "Epidemic",
    "spray_wait": "Spray-Wait (L=8)",
    "emrt":       "EMRT (Dynamic L)",
    "prophet":    "PRoPHET",
    "gossip":     "Gossip",
    "direct":     "Direct",
    "basic":      "Basic",
}


def _color(algo):
    return ALGO_COLORS.get(algo, "#374151")


def _label(algo):
    return ALGO_LABELS.get(algo, algo.capitalize())


def _ensure(path):
    os.makedirs(path, exist_ok=True)


# ── 1. Metric comparison bar charts ──────────────────────────────────────────

def plot_metric_comparison(scenario_results: dict, save_dir: str = "plots"):
    """
    For each metric, grouped bar chart: algorithms × scenarios.
    scenario_results: algo -> aggregated_metrics  (single scenario)
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        print("  matplotlib/numpy not installed — skipping plots")
        return

    _ensure(save_dir)
    algos = list(scenario_results.keys())
    metrics_to_plot = [
        ("ddr", "Data Delivery Rate (%)", "DDR"),
        ("dsr", "Data Survivability Rate (%)", "DSR"),
        ("overhead", "Overhead (msg / delivered pkt)", "Overhead"),
        ("avg_delay", "Average Delivery Delay (ticks)", "Avg Delay"),
        ("avg_energy", "Avg Energy Consumed (%)", "Avg Energy"),
        ("snapshot_accuracy", "Snapshot Accuracy (%)", "Snapshot Acc."),
    ]

    for key, ylabel, short_name in metrics_to_plot:
        fig, ax = plt.subplots(figsize=(9, 5))
        vals = [scenario_results[a].get(key, 0) for a in algos]
        errs = [scenario_results[a].get(f"{key}_std", 0) for a in algos]
        colors = [_color(a) for a in algos]
        x = np.arange(len(algos))
        bars = ax.bar(x, vals, yerr=errs, color=colors, edgecolor="white",
                      linewidth=0.8, capsize=5, alpha=0.9)
        ax.set_xticks(x)
        ax.set_xticklabels([_label(a) for a in algos], fontsize=10)
        ax.set_ylabel(ylabel)
        ax.set_title(f"{short_name} — AeroSnap vs Baselines")
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + max(errs) * 0.05 + 0.01,
                    f"{v:.1f}", ha="center", fontsize=9)
        fig.tight_layout()
        fname = os.path.join(save_dir, f"metric_{key}.png")
        fig.savefig(fname, dpi=150)
        plt.close(fig)
        print(f"  Saved {fname}")


# ── 2. Scenario heatmap ───────────────────────────────────────────────────────

def plot_scenario_heatmap(all_results: dict, metric: str = "ddr",
                          save_dir: str = "plots"):
    """
    Heatmap: rows = scenarios, cols = algorithms, cell = metric value.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        return

    _ensure(save_dir)
    scenario_names = [s for s in all_results if s != "scalability"]
    if not scenario_names:
        return

    algos = list(all_results[scenario_names[0]].keys())
    data = np.array([
        [all_results[sc].get(a, {}).get(metric, 0) for a in algos]
        for sc in scenario_names
    ])

    fig, ax = plt.subplots(figsize=(10, max(3, len(scenario_names) * 1.2)))
    im = ax.imshow(data, cmap="RdYlGn", aspect="auto",
                   vmin=0, vmax=100 if "rate" in metric or metric in ("ddr", "dsr", "snapshot_accuracy") else None)
    ax.set_xticks(range(len(algos)))
    ax.set_xticklabels([_label(a) for a in algos], fontsize=10)
    ax.set_yticks(range(len(scenario_names)))
    ax.set_yticklabels(scenario_names, fontsize=10)
    for i in range(len(scenario_names)):
        for j in range(len(algos)):
            ax.text(j, i, f"{data[i, j]:.1f}", ha="center", va="center",
                    fontsize=9, color="black")
    plt.colorbar(im, ax=ax, label=metric)
    ax.set_title(f"Scenario × Algorithm — {metric.upper()}")
    fig.tight_layout()
    fname = os.path.join(save_dir, f"heatmap_{metric}.png")
    fig.savefig(fname, dpi=150)
    plt.close(fig)
    print(f"  Saved {fname}")


# ── 3. Scalability curves ─────────────────────────────────────────────────────

def plot_scalability(scalability_results: dict, save_dir: str = "plots"):
    """
    X = drone count, Y = metric — one line per algorithm.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return

    _ensure(save_dir)
    metrics_to_plot = [
        ("ddr", "Data Delivery Rate (%)"),
        ("avg_delay", "Average Delay (ticks)"),
        ("overhead", "Overhead (msg / pkt)"),
        ("dsr", "Data Survivability Rate (%)"),
    ]

    for key, ylabel in metrics_to_plot:
        fig, ax = plt.subplots(figsize=(9, 5))
        for algo, counts_data in scalability_results.items():
            drone_counts = sorted(counts_data.keys(), key=int)
            vals = [counts_data[n].get(key, 0) for n in drone_counts]
            errs = [counts_data[n].get(f"{key}_std", 0) for n in drone_counts]
            ax.errorbar(
                [int(n) for n in drone_counts], vals, yerr=errs,
                label=_label(algo), color=_color(algo),
                marker="o", linewidth=1.8, capsize=4,
            )
        ax.set_xlabel("Number of Drones")
        ax.set_ylabel(ylabel)
        ax.set_title(f"Scalability — {ylabel}")
        ax.legend(fontsize=9)
        fig.tight_layout()
        fname = os.path.join(save_dir, f"scalability_{key}.png")
        fig.savefig(fname, dpi=150)
        plt.close(fig)
        print(f"  Saved {fname}")


# ── 4. Delivery timeline ──────────────────────────────────────────────────────

def plot_delivery_timelines(timelines: dict, save_dir: str = "plots"):
    """
    Cumulative DDR over time for each algorithm.
    timelines: algo -> list of (tick, cumulative_ddr)
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return

    _ensure(save_dir)
    fig, ax = plt.subplots(figsize=(10, 5))
    for algo, tl in timelines.items():
        if not tl:
            continue
        ticks, rates = zip(*tl)
        ax.plot(ticks, rates, label=_label(algo), color=_color(algo), linewidth=2)
    ax.set_xlabel("Simulation Time (ticks)")
    ax.set_ylabel("Cumulative Delivery Rate (%)")
    ax.set_title("Data Delivery Rate Over Time")
    ax.legend(fontsize=9)
    ax.set_ylim(0, 105)
    fig.tight_layout()
    fname = os.path.join(save_dir, "delivery_timeline.png")
    fig.savefig(fname, dpi=150)
    plt.close(fig)
    print(f"  Saved {fname}")


# ── 5. Network snapshot (static 2-D) ─────────────────────────────────────────

def plot_network_snapshot(sim, save_dir: str = "plots"):
    """
    Scatter plot of drone positions at end of simulation.
    sim: completed SimulationEngine instance
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatches
    except ImportError:
        return

    _ensure(save_dir)
    fig, ax = plt.subplots(figsize=(7, 7))

    alive_x, alive_y = [], []
    dead_x, dead_y = [], []
    for d in sim.drones:
        if d.alive:
            alive_x.append(d.x)
            alive_y.append(d.y)
        else:
            dead_x.append(d.x)
            dead_y.append(d.y)

    ax.scatter(alive_x, alive_y, c="#8B5CF6", s=60, label="Alive", zorder=3)
    ax.scatter(dead_x, dead_y, c="#EF4444", s=60, marker="x", label="Failed", zorder=3)
    ax.scatter(sim.base_x, sim.base_y, c="#F59E0B", s=200, marker="*",
               label="Base Station", zorder=4)

    circle = plt.Circle((sim.base_x, sim.base_y), sim.base_range,
                         color="#F59E0B", alpha=0.15, zorder=2)
    ax.add_patch(circle)

    # Draw communication links between alive drones
    import math
    for i, a in enumerate(sim.drones):
        if not a.alive:
            continue
        for b in sim.drones[i+1:]:
            if not b.alive:
                continue
            if math.hypot(a.x - b.x, a.y - b.y) <= sim.comm_range:
                ax.plot([a.x, b.x], [a.y, b.y], color="#CBD5E1",
                        linewidth=0.5, alpha=0.5, zorder=1)

    ax.set_xlim(0, sim.map_size)
    ax.set_ylim(0, sim.map_size)
    ax.set_aspect("equal")
    ax.set_title(f"Network — {sim.strategy.upper()} (t={sim.current_time})")
    ax.legend(fontsize=9)
    fig.tight_layout()
    fname = os.path.join(save_dir, f"network_{sim.strategy}.png")
    fig.savefig(fname, dpi=150)
    plt.close(fig)
    print(f"  Saved {fname}")


# ── 6. Failure-rate vs DDR trade-off ─────────────────────────────────────────

def plot_failure_vs_ddr(failure_rates, results_by_rate: dict,
                        save_dir: str = "plots"):
    """
    results_by_rate: failure_rate -> algo -> aggregated_metrics
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return

    _ensure(save_dir)
    algos = list(next(iter(results_by_rate.values())).keys())
    fig, ax = plt.subplots(figsize=(9, 5))
    for algo in algos:
        vals = [results_by_rate[fr].get(algo, {}).get("ddr", 0)
                for fr in failure_rates]
        ax.plot([fr * 100 for fr in failure_rates], vals,
                label=_label(algo), color=_color(algo),
                marker="o", linewidth=2)
    ax.set_xlabel("Failure Rate (% per minute)")
    ax.set_ylabel("Data Delivery Rate (%)")
    ax.set_title("Failure Rate vs DDR Trade-off")
    ax.legend(fontsize=9)
    fig.tight_layout()
    fname = os.path.join(save_dir, "failure_vs_ddr.png")
    fig.savefig(fname, dpi=150)
    plt.close(fig)
    print(f"  Saved {fname}")


# ── 7. EMRT dynamic-L distribution histogram ─────────────────────────────────

def plot_emrt_l_distribution(l_values: list, save_dir: str = "plots"):
    """
    Histogram of L values actually used by EMRT during a simulation run.
    Proves the algorithm adapts rather than always using L=3.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        return

    if not l_values:
        print("  No EMRT L values recorded — skipping histogram")
        return

    _ensure(save_dir)
    fig, ax = plt.subplots(figsize=(8, 5))
    bins = list(range(1, 12))
    counts, _, bars = ax.hist(l_values, bins=bins, color="#F97316",
                              edgecolor="white", linewidth=0.8, align="left")
    ax.axvline(3, color="#10B981", linewidth=2, linestyle="--",
               label="Fixed Spray-Wait L=3")
    ax.axvline(float(np.mean(l_values)), color="#1E293B", linewidth=2,
               linestyle="-", label=f"EMRT mean L={np.mean(l_values):.2f}")
    ax.set_xlabel("Replica Count (L)")
    ax.set_ylabel("Frequency")
    ax.set_title("EMRT Dynamic L Distribution\n(variation proves adaptive behaviour)")
    ax.set_xticks(range(1, 11))
    ax.legend(fontsize=9)
    fig.tight_layout()
    fname = os.path.join(save_dir, "emrt_l_distribution.png")
    fig.savefig(fname, dpi=150)
    plt.close(fig)
    print(f"  Saved {fname}")


# ── 8. EMRT vs Spray-Wait direct comparison ───────────────────────────────────

def plot_emrt_vs_spray_wait(results: dict, save_dir: str = "plots"):
    """
    Side-by-side bar chart: EMRT vs Spray-Wait on the key metrics.
    results: algo -> metrics dict (flat, not aggregated)
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        return

    if "emrt" not in results or "spray_wait" not in results:
        return

    _ensure(save_dir)
    metrics = [
        ("ddr",      "Delivery Rate (%)",    1.0),
        ("dsr",      "Survivability (%)",    1.0),
        ("overhead", "Overhead (msg/pkt)",   1.0),
        ("avg_delay","Avg Delay (ticks)",    1.0),
        ("avg_hops", "Avg Hops",             1.0),
    ]

    n = len(metrics)
    x = np.arange(n)
    width = 0.35
    sw_vals  = [results["spray_wait"].get(k, 0) * scale for k, _, scale in metrics]
    em_vals  = [results["emrt"].get(k, 0)       * scale for k, _, scale in metrics]
    sw_errs  = [results["spray_wait"].get(f"{k}_std", 0) for k, _, _ in metrics]
    em_errs  = [results["emrt"].get(f"{k}_std", 0)       for k, _, _ in metrics]

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.bar(x - width/2, sw_vals, width, yerr=sw_errs, label="Spray-Wait (L=3)",
           color="#10B981", edgecolor="white", capsize=4, alpha=0.9)
    ax.bar(x + width/2, em_vals, width, yerr=em_errs, label="EMRT (Dynamic L)",
           color="#F97316", edgecolor="white", capsize=4, alpha=0.9)
    ax.set_xticks(x)
    ax.set_xticklabels([label for _, label, _ in metrics], fontsize=9)
    ax.set_title("EMRT vs Spray-Wait — Direct Comparison")
    ax.legend(fontsize=10)
    fig.tight_layout()
    fname = os.path.join(save_dir, "emrt_vs_spray_wait.png")
    fig.savefig(fname, dpi=150)
    plt.close(fig)
    print(f"  Saved {fname}")


# ── Convenience: generate all standard plots from full evaluation ─────────────

def generate_all_plots(all_results: dict, timelines: dict = None,
                       save_dir: str = "plots"):
    _ensure(save_dir)

    # Per-scenario bar charts (use 'baseline' scenario)
    if "baseline" in all_results:
        plot_metric_comparison(all_results["baseline"], save_dir)
        plot_emrt_vs_spray_wait(all_results["baseline"], save_dir)

    # Heatmaps
    for metric in ("ddr", "dsr", "overhead"):
        plot_scenario_heatmap(all_results, metric=metric, save_dir=save_dir)

    # Scalability
    if "scalability" in all_results:
        plot_scalability(all_results["scalability"], save_dir)

    # Delivery timeline
    if timelines:
        plot_delivery_timelines(timelines, save_dir)

    print(f"\n  All plots saved to {save_dir}/")
