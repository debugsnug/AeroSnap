"""
simulation_engine.py — Discrete-tick simulation engine for AeroSnap evaluation.

Each tick represents one second of simulation time.
"""

import random
import math
import json
import os
from drone_node import DroneNode, DataPacket


class SimulationEngine:
    """
    Tick-based simulation engine.

    Parameters
    ----------
    num_drones         Number of drone nodes.
    duration           Total simulation ticks (seconds).
    strategy           Algorithm name string (resolved to instance internally).
    failure_rate       Per-tick probability of random drone failure.
    comm_range         Communication range in map units.
                       15 map units ≈ 500 m real-world (1 unit ≈ 33 m).
    map_size           Square map side length (100 units ≈ 3.3 km).
    data_collect_prob  Per-tick probability a drone collects a data item.
    collect_interval   Collect data every N ticks.
    partition_config   Dict with keys 'start', 'end', 'x_split' to simulate
                       a network partition (drones on opposite sides can't talk).
    packet_loss        Probability that a data transfer is silently dropped.
    bandwidth_limit    Max data-item transfers per drone pair per tick
                       (models 1 Mbps link with ~3 MB avg packet size).
    seed               Optional random seed for reproducibility.
    """

    def __init__(
        self,
        num_drones: int = 20,
        duration: int = 3600,
        strategy: str = "aerosnap",
        failure_rate: float = 0.001,
        comm_range: float = 15.0,
        map_size: float = 100.0,
        data_collect_prob: float = 0.10,
        collect_interval: int = 5,
        partition_config: dict = None,
        packet_loss: float = 0.05,
        bandwidth_limit: int = 5,
        seed: int = None,
    ):
        self._seed = seed          # stored so run() can replay it exactly
        if seed is not None:
            random.seed(seed)

        self.num_drones = num_drones
        self.duration = duration
        self.strategy = strategy
        self.failure_rate = failure_rate
        self.comm_range = comm_range
        self.map_size = map_size
        self.data_collect_prob = data_collect_prob
        self.collect_interval = collect_interval
        self.partition_config = partition_config or {}
        self.packet_loss = packet_loss
        self.bandwidth_limit = bandwidth_limit
        self.current_time = 0

        # Algorithm
        self.algorithm = self._build_algorithm(strategy)

        # Base station (edge of map — simulates forward operating base at zone edge)
        self.base_x = 5.0
        self.base_y = map_size / 2
        self.base_range = 11.0   # ~360 m real-world delivery radius

        # Drone initialisation
        ids = [f"D{i+1}" for i in range(num_drones)]
        self.drones: list[DroneNode] = [
            DroneNode(
                drone_id=ids[i],
                x=random.uniform(5, map_size - 5),
                y=random.uniform(5, map_size - 5),
                battery=random.uniform(60, 100),
                all_drone_ids=ids,
            )
            for i in range(num_drones)
        ]

        # Delivered packets (master record — each data_id appears at most once)
        self.delivered_data: list[DataPacket] = []
        self._delivered_ids: set = set()

        # Aggregate metrics
        self.metrics = {
            "messages_exchanged": 0,
            "markers_sent": 0,
            "ttl_expired": 0,
            "pruned_packets": 0,
        }

        # Delivery rate timeline: list of (tick, cumulative_ddr)
        self.delivery_timeline: list[tuple] = []

        # Frame log for dashboard export (optional — only populated if requested)
        self._record_frames: bool = False
        self.frame_log: list[dict] = []

    # ── Algorithm factory ─────────────────────────────────────────────────

    def _build_algorithm(self, name: str):
        if name == "aerosnap":
            from aerosnap_algorithm import AeroSnapAlgorithm
            return AeroSnapAlgorithm()
        from baseline_algorithms import get_algorithm
        return get_algorithm(name)

    # ── Partition helper ──────────────────────────────────────────────────

    def _in_partition(self, t: int) -> bool:
        pc = self.partition_config
        return bool(pc) and pc.get("start", 0) <= t < pc.get("end", 0)

    def _partitioned_pair(self, a: DroneNode, b: DroneNode, t: int) -> bool:
        """Return True if the two drones are in different partition halves."""
        if not self._in_partition(t):
            return False
        split = self.partition_config.get("x_split", self.map_size / 2)
        a_side = a.x < split
        b_side = b.x < split
        return a_side != b_side

    # ── Simulation loop ───────────────────────────────────────────────────

    def run(self, record_frames: bool = False) -> dict:
        self._record_frames = record_frames
        # Re-apply seed so this run is independent of any prior RNG consumption
        if self._seed is not None:
            random.seed(self._seed)
        DataPacket._counter = 0  # reset global ID counter for reproducibility

        for t in range(1, self.duration + 1):
            self.current_time = t
            self._step(t)

        from metrics import compute_metrics
        return compute_metrics(self)

    def _step(self, t: int):
        alive = [d for d in self.drones if d.alive]

        # 1. Move
        for d in alive:
            d.move(self.map_size, self.map_size)

        # 2. Collect data
        if t % self.collect_interval == 0:
            for d in [x for x in self.drones if x.alive]:
                d.collect_data(t, self.data_collect_prob)

        # 3. Random failures (Poisson process approximation)
        for d in [x for x in self.drones if x.alive]:
            if random.random() < self.failure_rate:
                d.alive = False
                d.data_items = {}   # data lost on failed drone

        alive = [d for d in self.drones if d.alive]

        # 3b. TTL expiry — drop packets whose time-to-live has run out
        for d in alive:
            expired = []
            for did, item in d.data_items.items():
                if item.ttl is None:
                    continue
                item.ttl -= 1
                if item.ttl <= 0:
                    expired.append(did)
            for did in expired:
                d.data_items.pop(did, None)
                d.spray_copies.pop(did, None)
                self.metrics["ttl_expired"] += 1

        # 4. Deliver to base station — clear delivered items from carrier buffer
        for d in alive:
            dist = math.hypot(d.x - self.base_x, d.y - self.base_y)
            at_base = dist <= self.base_range
            if not at_base:
                continue

            # PRoPHET: drone near base gains P(BASE) experience
            if self.strategy == "prophet":
                P_INIT = 0.75
                old = d.delivery_pred.get('BASE', 0.0)
                d.delivery_pred['BASE'] = old + (1 - old) * P_INIT
                d.last_encounter['BASE'] = t

            newly_delivered = []
            stale = []
            for did, item in list(d.data_items.items()):
                if did in self._delivered_ids:
                    stale.append(did)
                elif random.random() > self.packet_loss:
                    item.delivered = True
                    item.delivery_time = t
                    self.delivered_data.append(item)
                    self._delivered_ids.add(did)
                    if d.local_snapshot is not None:
                        d.local_snapshot["data_ids"].add(did)
                    newly_delivered.append(did)
                else:
                    stale.append(did)   # lost due to packet_loss

            for did in newly_delivered:
                d.mark_delivered(did)   # records in delivered_ids, removes from buffer
            for did in stale:
                d.data_items.pop(did, None)
                d.spray_copies.pop(did, None)

        # 5. AeroSnap: adaptive snapshot triggering
        if self.strategy == "aerosnap":
            for d in alive:
                self.algorithm.maybe_initiate_snapshot(d, t)

        # 6. Neighbour detection and exchange (bandwidth-limited)
        for i in range(len(alive)):
            for j in range(i + 1, len(alive)):
                a, b = alive[i], alive[j]
                if math.hypot(a.x - b.x, a.y - b.y) > self.comm_range:
                    continue
                if self._partitioned_pair(a, b, t):
                    continue
                # Update connectivity counts
                a.connectivity_count = getattr(a, "_nb_count", 0) + 1
                b.connectivity_count = getattr(b, "_nb_count", 0) + 1
                # Record messages before exchange to enforce bandwidth limit
                before = self.metrics.get("messages_exchanged", 0)
                self.algorithm.exchange(a, b, t, self.metrics)
                # Cap transfers at bandwidth_limit per pair per tick
                transferred = self.metrics.get("messages_exchanged", 0) - before
                if transferred > self.bandwidth_limit:
                    self.metrics["messages_exchanged"] = before + self.bandwidth_limit

        # Reset per-tick connectivity counts
        for d in alive:
            d._nb_count = 0
            d.connectivity_count = len([
                o for o in alive
                if o.drone_id != d.drone_id
                and math.hypot(d.x - o.x, d.y - o.y) <= self.comm_range
            ])

        # 7. Record timeline snapshot every 60 ticks
        if t % 60 == 0 or t == self.duration:
            total_ids = set()
            for d in self.drones:
                total_ids |= set(d.data_items.keys())
            for item in self.delivered_data:
                total_ids.add(item.data_id)
            ddr = len(self.delivered_data) / max(len(total_ids), 1) * 100
            self.delivery_timeline.append((t, round(ddr, 2)))

        # 8. Frame log
        if self._record_frames:
            self.frame_log.append({
                "t": t,
                "drones": [d.to_dict() for d in self.drones],
            })

    # ── Export ────────────────────────────────────────────────────────────

    def export_json(self, filepath: str):
        data = {
            "strategy": self.strategy,
            "total_steps": self.current_time,
            "frames": self.frame_log,
            "delivered": [item.to_dict() for item in self.delivered_data],
        }
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)
        print(f"  Exported {len(self.frame_log)} frames -> {filepath}")
