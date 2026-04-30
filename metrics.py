"""
metrics.py — Metric calculation for AeroSnap simulation results.

Metrics
-------
DDR      Data Delivery Rate (%)
delay    avg / max / p95 delivery delay (ticks)
DSR      Data Survivability Rate (%)
SA       Snapshot Accuracy (%) — AeroSnap only
overhead Communication Overhead (messages / delivered packet)
energy   Average battery consumed per drone (%)
hops     avg / max hop count for delivered packets
"""

import statistics
from typing import List


def compute_metrics(sim) -> dict:
    """
    Compute all metrics from a completed SimulationEngine instance.

    Parameters
    ----------
    sim : SimulationEngine  (imported locally to avoid circular imports)
    """
    all_ids: set = set()
    for d in sim.drones:
        all_ids |= set(d.data_items.keys())
    for item in sim.delivered_data:
        all_ids.add(item.data_id)

    total_generated = len(all_ids)
    delivered_items = sim.delivered_data   # list of DataPacket

    # ── DDR ──────────────────────────────────────────────────────────────
    ddr = len(delivered_items) / max(total_generated, 1) * 100

    # ── Delivery delay ────────────────────────────────────────────────────
    delays = [
        item.delivery_time - item.generation_time
        for item in delivered_items
        if item.delivery_time is not None
    ]
    avg_delay = statistics.mean(delays) if delays else 0.0
    max_delay = max(delays) if delays else 0.0
    p95_delay = _percentile(delays, 95) if delays else 0.0

    # ── DSR (data survives on ≥1 alive drone or delivered) ───────────────
    alive_data_ids: set = set()
    for d in sim.drones:
        if d.alive:
            alive_data_ids |= set(d.data_items.keys())
    for item in sim.delivered_data:
        alive_data_ids.add(item.data_id)
    dsr = len(alive_data_ids) / max(total_generated, 1) * 100

    # ── Snapshot accuracy (AeroSnap only) ─────────────────────────────────
    snapshot_accuracy = _snapshot_accuracy(sim, all_ids)

    # ── Communication overhead (avg copies per data item generated) ─────
    overhead = sim.metrics.get("messages_exchanged", 0) / max(total_generated, 1)

    # ── Energy ────────────────────────────────────────────────────────────
    consumed = [
        d.initial_battery - d.battery
        for d in sim.drones
    ]
    avg_energy = statistics.mean(consumed) if consumed else 0.0

    # ── Hops ──────────────────────────────────────────────────────────────
    hop_counts = [item.hops for item in delivered_items]
    avg_hops = statistics.mean(hop_counts) if hop_counts else 0.0
    max_hops = max(hop_counts) if hop_counts else 0

    # ── Drones alive ──────────────────────────────────────────────────────
    drones_alive = sum(1 for d in sim.drones if d.alive)

    return {
        "strategy": sim.strategy,
        "total_generated": total_generated,
        "delivered": len(delivered_items),
        "ddr": round(ddr, 2),
        "avg_delay": round(avg_delay, 2),
        "max_delay": round(max_delay, 2),
        "p95_delay": round(p95_delay, 2),
        "dsr": round(dsr, 2),
        "snapshot_accuracy": round(snapshot_accuracy, 2),
        "messages_exchanged": sim.metrics.get("messages_exchanged", 0),
        "markers_sent": sim.metrics.get("markers_sent", 0),
        "ttl_expired": sim.metrics.get("ttl_expired", 0),
        "pruned_packets": sim.metrics.get("pruned_packets", 0),
        "overhead": round(overhead, 3),
        "avg_energy": round(avg_energy, 2),
        "avg_hops": round(avg_hops, 2),
        "max_hops": max_hops,
        "drones_alive": drones_alive,
        "total_drones": len(sim.drones),
    }


def _percentile(data: List[float], pct: int) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    idx = int(len(sorted_data) * pct / 100)
    idx = min(idx, len(sorted_data) - 1)
    return sorted_data[idx]


def _snapshot_accuracy(sim, all_ids: set) -> float:
    """
    Fraction of all currently-known data IDs captured in any snapshot.
    Only meaningful for AeroSnap; returns 0 for other strategies.
    """
    if sim.strategy != "aerosnap":
        return 0.0
    snapshot_ids: set = set()
    for d in sim.drones:
        if d.local_snapshot:
            snapshot_ids |= d.local_snapshot["data_ids"]
    if not all_ids:
        return 100.0
    return len(snapshot_ids & all_ids) / len(all_ids) * 100


def aggregate_runs(metrics_list: List[dict]) -> dict:
    """
    Aggregate a list of per-run metric dicts into mean ± stddev summary.
    Numeric fields are aggregated; string / meta fields taken from first run.
    """
    if not metrics_list:
        return {}

    numeric_keys = [
        k for k, v in metrics_list[0].items() if isinstance(v, (int, float))
    ]
    result = {
        k: v for k, v in metrics_list[0].items()
        if not isinstance(v, (int, float))
    }

    for key in numeric_keys:
        vals = [m[key] for m in metrics_list]
        result[key] = round(statistics.mean(vals), 3)
        result[f"{key}_std"] = round(statistics.stdev(vals) if len(vals) > 1 else 0.0, 3)
        result[f"{key}_min"] = round(min(vals), 3)
        result[f"{key}_max"] = round(max(vals), 3)

    result["num_runs"] = len(metrics_list)
    return result


def print_metrics_table(metrics_by_strategy: dict):
    """Pretty-print a comparison table for a set of strategy results."""
    rows = [
        ("DDR (%)", "ddr"),
        ("DSR (%)", "dsr"),
        ("Avg Delay (ticks)", "avg_delay"),
        ("P95 Delay (ticks)", "p95_delay"),
        ("Snapshot Accuracy (%)", "snapshot_accuracy"),
        ("Overhead (msg/pkt)", "overhead"),
        ("Avg Energy (%)", "avg_energy"),
        ("Avg Hops", "avg_hops"),
        ("TTL Expired", "ttl_expired"),
        ("Pruned (AeroSnap)", "pruned_packets"),
        ("Drones Alive", "drones_alive"),
        ("Messages Exchanged", "messages_exchanged"),
    ]
    strategies = list(metrics_by_strategy.keys())
    col_w = 14

    header = f"  {'METRIC':<25}" + "".join(f"{s.upper():>{col_w}}" for s in strategies)
    print("\n" + "=" * len(header))
    print(header)
    print("=" * len(header))

    for label, key in rows:
        vals = []
        for s in strategies:
            m = metrics_by_strategy[s]
            v = m.get(key, "-")
            std = m.get(f"{key}_std")
            if std is not None:
                vals.append(f"{v}+/-{std}"[:col_w - 1])
            else:
                vals.append(str(v))
        row = f"  {label:<25}" + "".join(f"{v:>{col_w}}" for v in vals)
        print(row)

    print("=" * len(header))
