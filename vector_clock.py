"""
vector_clock.py — Vector Clock implementation for AeroSnap distributed snapshot.

Provides causal ordering in an asynchronous distributed system without
a global clock.  Each drone maintains a vector clock indexed by drone IDs.
"""


class VectorClock:
    """
    Vector clock for causal ordering across drone nodes.

    Each entry maps a node_id → logical_timestamp (integer).
    """

    def __init__(self, node_id, all_node_ids=None):
        self.node_id = node_id
        self.clock = {}
        if all_node_ids:
            for nid in all_node_ids:
                self.clock[nid] = 0

    def tick(self):
        """Increment this node's logical time by 1."""
        self.clock[self.node_id] = self.clock.get(self.node_id, 0) + 1

    def send_event(self):
        """Increment clock and return a copy (for attaching to a message)."""
        self.tick()
        return dict(self.clock)

    def receive_event(self, other_clock):
        """Merge incoming clock (element‑wise max) then increment own entry."""
        for node_id, ts in other_clock.items():
            self.clock[node_id] = max(self.clock.get(node_id, 0), ts)
        self.tick()

    def merge(self, other_clock):
        """Element‑wise max merge *without* incrementing own entry."""
        for node_id, ts in other_clock.items():
            self.clock[node_id] = max(self.clock.get(node_id, 0), ts)

    def dominates(self, other_clock):
        """True if every component of self >= the corresponding component of other."""
        all_keys = set(self.clock.keys()) | set(other_clock.keys())
        return all(
            self.clock.get(k, 0) >= other_clock.get(k, 0)
            for k in all_keys
        )

    def is_concurrent(self, other_clock):
        """True if neither clock dominates the other (concurrent events)."""
        all_keys = set(self.clock.keys()) | set(other_clock.keys())
        self_gte = all(self.clock.get(k, 0) >= other_clock.get(k, 0)
                       for k in all_keys)
        other_gte = all(other_clock.get(k, 0) >= self.clock.get(k, 0)
                        for k in all_keys)
        return not self_gte and not other_gte

    def copy(self):
        """Return a deep copy of this vector clock."""
        vc = VectorClock(self.node_id)
        vc.clock = dict(self.clock)
        return vc

    def to_dict(self):
        return dict(self.clock)

    @classmethod
    def from_dict(cls, node_id, data):
        vc = cls(node_id)
        vc.clock = dict(data)
        return vc

    def __repr__(self):
        entries = ", ".join(f"{k}:{v}" for k, v in sorted(self.clock.items()))
        return f"VC({self.node_id})[{entries}]"
