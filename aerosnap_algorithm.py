"""
aerosnap_algorithm.py — AeroSnap: Adaptive Partition-Aware Distributed Snapshot
with opportunistic priority-gated replication.

Core ideas
----------
* Modified Chandy-Lamport snapshot markers propagated on every encounter.
* Adaptive snapshot frequency: trigger interval depends on neighbourhood size.
* Priority-gated replication: only replicate packets with priority >= threshold.
* Partition detection: partition_id converges to max across connected components.
"""

from drone_node import DroneNode


PRIORITY_THRESHOLD = 0.4
AEROSNAP_COPY_BUDGET = 8   # max copies per data item (like Spray L=8)


class AeroSnapAlgorithm:
    """
    Implements the AeroSnap exchange logic called by SimulationEngine.

    All mutable state lives in DroneNode objects; this class is stateless
    except for the aggregate counters it updates in the metrics dict.
    """

    name = "aerosnap"

    def exchange(self, a: DroneNode, b: DroneNode, t: int, metrics: dict):
        """
        Full AeroSnap encounter between drones a and b at time t.

        Steps
        -----
        1. Propagate snapshot markers (Chandy-Lamport).
        2. Priority-gated opportunistic data replication.
        """
        self._exchange_markers(a, b, t, metrics)
        self._replicate_data(a, b, metrics)

    # ── Marker exchange ───────────────────────────────────────────────────

    def _exchange_markers(self, a: DroneNode, b: DroneNode, t: int, metrics: dict):
        if a.local_snapshot and b.drone_id not in a.marker_sent_to:
            b.merge_snapshot(a.local_snapshot, t)
            a.marker_sent_to.add(b.drone_id)
            metrics["markers_sent"] = metrics.get("markers_sent", 0) + 1

        if b.local_snapshot and a.drone_id not in b.marker_sent_to:
            a.merge_snapshot(b.local_snapshot, t)
            b.marker_sent_to.add(a.drone_id)
            metrics["markers_sent"] = metrics.get("markers_sent", 0) + 1

    # ── Priority-gated replication ────────────────────────────────────────

    def _replicate_data(self, a: DroneNode, b: DroneNode, metrics: dict):
        # Exclude items the destination has *ever* held (prevents re-receive cycle)
        a_missing = set(b.data_items) - set(a.data_items) - a.ever_held_ids
        b_missing = set(a.data_items) - set(b.data_items) - b.ever_held_ids

        for did in sorted(a_missing,
                          key=lambda x: b.data_items[x].priority, reverse=True):
            if len(a.data_items) >= a.MAX_DATA:
                break
            item = b.data_items[did]
            copies_left = b.spray_copies.get(did, 1)
            if item.priority >= PRIORITY_THRESHOLD and copies_left > 1:
                give = copies_left // 2
                keep = copies_left - give
                b.spray_copies[did] = keep
                copy = item.copy()
                copy.hops += 1
                a.data_items[did] = copy
                a.ever_held_ids.add(did)
                a.spray_copies[did] = give
                metrics["messages_exchanged"] = metrics.get("messages_exchanged", 0) + 1

        for did in sorted(b_missing,
                          key=lambda x: a.data_items[x].priority, reverse=True):
            if len(b.data_items) >= b.MAX_DATA:
                break
            item = a.data_items[did]
            copies_left = a.spray_copies.get(did, 1)
            if item.priority >= PRIORITY_THRESHOLD and copies_left > 1:
                give = copies_left // 2
                keep = copies_left - give
                a.spray_copies[did] = keep
                copy = item.copy()
                copy.hops += 1
                b.data_items[did] = copy
                b.ever_held_ids.add(did)
                b.spray_copies[did] = give
                metrics["messages_exchanged"] = metrics.get("messages_exchanged", 0) + 1

    # ── Adaptive snapshot triggering (called by engine each tick) ─────────

    def maybe_initiate_snapshot(self, drone: DroneNode, t: int):
        """Trigger a new snapshot if adaptive interval has elapsed."""
        freq = drone.get_snapshot_frequency()
        if t - drone.last_snapshot_time >= freq:
            drone.initiate_snapshot(t)
