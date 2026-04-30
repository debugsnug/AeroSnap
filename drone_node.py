"""
drone_node.py — DroneNode and DataPacket for AeroSnap simulation.
"""

import random
import math
from vector_clock import VectorClock


class DataPacket:
    """A single data item collected or replicated by a drone."""

    _counter = 0

    def __init__(self, source_id, timestamp, priority=None, size_mb=None, ttl=800):
        DataPacket._counter += 1
        self.data_id = f"{source_id}-{DataPacket._counter}"
        self.source_id = source_id
        self.generation_time = timestamp
        self.priority = priority if priority is not None else round(random.uniform(0.3, 1.0), 2)
        self.size_mb = size_mb if size_mb is not None else round(random.uniform(1.0, 5.0), 2)
        self.ttl = ttl          # time-to-live in ticks; None = immortal
        self.hops = 0
        self.delivered = False
        self.delivery_time = None

    def copy(self):
        p = DataPacket.__new__(DataPacket)
        p.data_id = self.data_id
        p.source_id = self.source_id
        p.generation_time = self.generation_time
        p.priority = self.priority
        p.size_mb = self.size_mb
        p.ttl = self.ttl
        p.hops = self.hops
        p.delivered = self.delivered
        p.delivery_time = self.delivery_time
        return p

    def to_dict(self):
        return {
            "data_id": self.data_id,
            "source": self.source_id,
            "gen_time": self.generation_time,
            "priority": self.priority,
            "ttl": self.ttl,
            "hops": self.hops,
            "delivered": self.delivered,
            "delivery_time": self.delivery_time,
        }


class DroneNode:
    """
    Autonomous drone node.

    Supports AeroSnap (vector clocks + snapshots), Spray-and-Wait copy
    counters, and PRoPHET delivery predictability — algorithms only use
    the fields they need.
    """

    MAX_DATA = 60  # maximum data items in buffer

    def __init__(self, drone_id, x, y, battery, all_drone_ids):
        self.drone_id = drone_id
        self.x = x
        self.y = y
        self.battery = battery
        self.alive = True
        self.initial_battery = battery

        # Data buffer: data_id -> DataPacket
        self.data_items: dict = {}

        # Spray-and-Wait: remaining copy budget per data_id
        self.spray_copies: dict = {}

        # PRoPHET: delivery predictability per destination (drone_id or 'BASE')
        self.delivery_pred: dict = {nid: 0.0 for nid in all_drone_ids}
        self.delivery_pred['BASE'] = 0.0          # routing destination for all packets
        self.last_encounter: dict = {nid: 0 for nid in all_drone_ids}
        self.last_encounter['BASE'] = 0

        # Vector clock (AeroSnap)
        self.vector_clock = VectorClock(drone_id, all_drone_ids)

        # Snapshot state (AeroSnap)
        self.local_snapshot = None
        self.last_snapshot_time = 0
        self.partition_id = drone_id
        self.connectivity_count = 0
        self.marker_sent_to: set = set()

        # Random-waypoint mobility state
        self.dest_x = random.uniform(5, 95)
        self.dest_y = random.uniform(5, 95)
        self.speed = random.uniform(3.0, 7.0)   # map units / tick (scaled)
        self.pause_ticks = 0

        # Lifetime stats
        self.data_collected = 0
        self.snapshots_initiated = 0
        self.snapshots_merged = 0
        self.total_encounters = 0       # cumulative neighbour contacts (for EMRT)
        self.ever_held_ids: set = set() # all data IDs this drone has ever buffered

        # Delivery awareness — propagated via snapshot merges (AeroSnap)
        self.delivered_ids: set = set()

    # ── Mobility ──────────────────────────────────────────────────────────

    def move(self, map_w=100, map_h=100):
        if not self.alive:
            return
        if self.pause_ticks > 0:
            self.pause_ticks -= 1
            self.battery = max(0.0, self.battery - 0.002)
            if self.battery <= 0:
                self.alive = False
            return
        dx = self.dest_x - self.x
        dy = self.dest_y - self.y
        dist = math.hypot(dx, dy)
        step = self.speed * 0.1
        if dist <= step:
            self.x, self.y = self.dest_x, self.dest_y
            self.pause_ticks = random.randint(5, 30)
            self.dest_x = random.uniform(5, map_w - 5)
            self.dest_y = random.uniform(5, map_h - 5)
        else:
            self.x += (dx / dist) * step
            self.y += (dy / dist) * step
        self.battery = max(0.0, self.battery - 0.004)
        if self.battery <= 0:
            self.alive = False

    def distance_to(self, other: "DroneNode") -> float:
        return math.hypot(self.x - other.x, self.y - other.y)

    # ── Data collection ───────────────────────────────────────────────────

    def collect_data(self, t: int, prob: float = 0.10, spray_l: int = 8) -> "DataPacket | None":
        if not self.alive or len(self.data_items) >= self.MAX_DATA:
            return None
        if random.random() > prob:
            return None
        self.data_collected += 1
        packet = DataPacket(self.drone_id, t)
        self.data_items[packet.data_id] = packet
        self.ever_held_ids.add(packet.data_id)
        self.spray_copies[packet.data_id] = spray_l
        self.vector_clock.tick()
        return packet

    # ── AeroSnap snapshot ─────────────────────────────────────────────────

    def get_snapshot_frequency(self) -> int:
        """Adaptive frequency based on current neighbour count."""
        if self.connectivity_count >= 3:
            return 8    # high connectivity: snapshot every 8 ticks
        elif self.connectivity_count >= 1:
            return 15   # medium: every 15 ticks
        else:
            return 25   # isolated: every 25 ticks

    def initiate_snapshot(self, t: int):
        self.vector_clock.tick()
        self.local_snapshot = {
            "drone_id": self.drone_id,
            "snapshot_time": t,
            "vector_clock": self.vector_clock.to_dict(),
            "data_ids": set(self.data_items.keys()) | self.ever_held_ids,
            "delivered_ids": set(self.delivered_ids),
            "known_nodes": {self.drone_id},
            "partition_id": self.partition_id,
            "merged_count": 0,
        }
        self.marker_sent_to = set()
        self.last_snapshot_time = t
        self.snapshots_initiated += 1

    def mark_delivered(self, data_id: str):
        """Record that a packet reached base; remove it from local buffer."""
        self.delivered_ids.add(data_id)
        self.data_items.pop(data_id, None)
        self.spray_copies.pop(data_id, None)

    def merge_snapshot(self, other_snap: dict, t: int):
        """Merge an incoming snapshot using element-wise-max vector clocks."""
        if self.local_snapshot is None:
            self.initiate_snapshot(t)
        s = self.local_snapshot
        o = other_snap
        for nid, ts in o["vector_clock"].items():
            s["vector_clock"][nid] = max(s["vector_clock"].get(nid, 0), ts)
        s["data_ids"] |= o["data_ids"]
        # Propagate delivered_ids and update live awareness
        incoming_delivered = o.get("delivered_ids", set())
        s.setdefault("delivered_ids", set())
        s["delivered_ids"] |= incoming_delivered
        self.delivered_ids |= incoming_delivered   # live awareness for routing
        s["known_nodes"] |= o["known_nodes"]
        old_part = self.partition_id
        self.partition_id = max(self.partition_id, o["partition_id"])
        s["partition_id"] = self.partition_id
        s["merged_count"] = s["merged_count"] + 1
        s["snapshot_time"] = max(s["snapshot_time"], o["snapshot_time"])
        self.vector_clock.receive_event(o["vector_clock"])
        self.snapshots_merged += 1
        return self.partition_id != old_part  # True => partition merge detected

    def snapshot_convergence_ratio(self, total_nodes: int) -> float:
        if self.local_snapshot is None:
            return 0.0
        return len(self.local_snapshot["known_nodes"]) / max(total_nodes, 1)

    # ── Serialization ─────────────────────────────────────────────────────

    def to_dict(self):
        return {
            "id": self.drone_id,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "battery": round(self.battery, 1),
            "alive": self.alive,
            "data_count": len(self.data_items),
            "has_snapshot": self.local_snapshot is not None,
            "snapshot_nodes": (
                len(self.local_snapshot["known_nodes"]) if self.local_snapshot else 0
            ),
        }
