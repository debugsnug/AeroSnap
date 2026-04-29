"""
baseline_algorithms.py — Baseline routing / replication algorithms.

Each algorithm exposes:
    .name          str
    .exchange(a, b, t, metrics)   called on every drone encounter
    .maybe_initiate_snapshot(drone, t)  no-op for non-AeroSnap algorithms

Algorithms implemented
----------------------
EpidemicAlgorithm    — Pure flooding: exchange everything on contact.
SprayWaitAlgorithm   — Spray L=3 copies, then wait for direct delivery.
PRoPHETAlgorithm     — Forward if neighbour has higher delivery predictability.
BasicReplication     — Same as Epidemic (explicit alias for clarity in tables).
GossipAlgorithm      — Probabilistic forwarding with configurable probability.
DirectDelivery       — No inter-drone exchange; direct to base station only.
"""

import random
from drone_node import DroneNode


# ── Helpers ───────────────────────────────────────────────────────────────────

def _transfer(src: DroneNode, dst: DroneNode, did: str, metrics: dict) -> bool:
    """
    Copy a single data packet from src to dst.

    Guards:
    * Skip if dst already held this item (prevents the re-receive cycle
      where items are delivered, cleared, then re-accepted from neighbours).
    * If dst buffer is full, evict the lowest-priority undelivered item only
      if the incoming item has strictly higher priority (priority-based eviction).
    Returns True if the transfer succeeded.
    """
    # ── Prevent re-receive of already-held / already-delivered items ──
    if did in dst.ever_held_ids:
        return False

    incoming = src.data_items[did]
    if len(dst.data_items) >= dst.MAX_DATA:
        # Try priority eviction
        evict_id, evict_item = min(
            dst.data_items.items(), key=lambda kv: kv[1].priority
        )
        if incoming.priority <= evict_item.priority:
            return False   # not worth evicting
        dst.data_items.pop(evict_id)
        dst.spray_copies.pop(evict_id, None)

    item = incoming.copy()
    item.hops += 1
    dst.data_items[did] = item
    dst.ever_held_ids.add(did)
    dst.spray_copies[did] = src.spray_copies.get(did, 1)
    metrics["messages_exchanged"] = metrics.get("messages_exchanged", 0) + 1
    return True


# ── Epidemic (Pure Flooding) ──────────────────────────────────────────────────

class EpidemicAlgorithm:
    """Exchange ALL data packets on contact. Maximum delivery, maximum overhead."""

    name = "epidemic"

    def exchange(self, a: DroneNode, b: DroneNode, _t: int, metrics: dict):
        for did in list(set(b.data_items) - set(a.data_items)):
            _transfer(b, a, did, metrics)
        for did in list(set(a.data_items) - set(b.data_items)):
            _transfer(a, b, did, metrics)

    def maybe_initiate_snapshot(self, drone: DroneNode, _t: int):
        pass


# ── Spray-and-Wait ────────────────────────────────────────────────────────────

class SprayWaitAlgorithm:
    """
    Spray L=8 copies of each message, then wait for direct delivery.

    When a node holding C > 1 copies meets a node without the message,
    it gives floor(C/2) copies to the other and keeps ceil(C/2).
    When C == 1, the node waits and only delivers directly to the base station.
    """

    name = "spray_wait"
    L = 8  # initial copy budget

    def exchange(self, a: DroneNode, b: DroneNode, _t: int, metrics: dict):
        self._spray(a, b, metrics)
        self._spray(b, a, metrics)

    def _spray(self, src: DroneNode, dst: DroneNode, metrics: dict):
        for did, item in list(src.data_items.items()):
            if did in dst.data_items:
                continue
            copies = src.spray_copies.get(did, 1)
            if copies <= 1:
                continue  # wait phase: hold for direct delivery
            give = copies // 2
            keep = copies - give
            src.spray_copies[did] = keep
            if _transfer(src, dst, did, metrics):
                dst.spray_copies[did] = give

    def maybe_initiate_snapshot(self, drone: DroneNode, _t: int):
        pass


# ── PRoPHET ───────────────────────────────────────────────────────────────────

class PRoPHETAlgorithm:
    """
    Probabilistic Routing Protocol using History of Encounters and Transitivity.

    Parameters
    ----------
    p_init  : encounter update weight (default 0.75)
    beta    : transitivity scaling factor (default 0.25)
    gamma   : temporal aging factor per tick (default 0.999)
    """

    name = "prophet"

    def __init__(self, p_init: float = 0.75, beta: float = 0.25, gamma: float = 0.999):
        self.p_init = p_init
        self.beta = beta
        self.gamma = gamma

    def exchange(self, a: DroneNode, b: DroneNode, t: int, metrics: dict):
        self._age_predictions(a, t)
        self._age_predictions(b, t)
        self._update_pred_on_encounter(a, b, t)
        self._update_pred_on_encounter(b, a, t)
        self._forward_messages(a, b, metrics)
        self._forward_messages(b, a, metrics)

    def _age_predictions(self, drone: DroneNode, t: int):
        for nid in list(drone.delivery_pred):
            elapsed = t - drone.last_encounter.get(nid, 0)
            drone.delivery_pred[nid] *= (self.gamma ** elapsed)

    def _update_pred_on_encounter(self, a: DroneNode, b: DroneNode, t: int):
        old = a.delivery_pred.get(b.drone_id, 0.0)
        a.delivery_pred[b.drone_id] = old + (1 - old) * self.p_init
        a.last_encounter[b.drone_id] = t
        # Transitivity: update predictions for nodes b knows
        for nid, b_pred in b.delivery_pred.items():
            if nid == a.drone_id:
                continue
            a_pred = a.delivery_pred.get(nid, 0.0)
            a.delivery_pred[nid] = max(
                a_pred,
                a.delivery_pred.get(b.drone_id, 0.0) * b_pred * self.beta,
            )

    def _forward_messages(self, src: DroneNode, relay: DroneNode, metrics: dict):
        """Forward from src to relay if relay has higher predictability for destination."""
        for did, item in list(src.data_items.items()):
            if did in relay.data_items:
                continue
            dest = item.source_id
            src_pred = src.delivery_pred.get(dest, 0.0)
            relay_pred = relay.delivery_pred.get(dest, 0.0)
            if relay_pred > src_pred:
                _transfer(src, relay, did, metrics)

    def maybe_initiate_snapshot(self, drone: DroneNode, _t: int):
        pass


# ── Basic Replication (Epidemic alias) ───────────────────────────────────────

class BasicReplication(EpidemicAlgorithm):
    """Flood everything — explicit alias used in comparative tables."""
    name = "basic"


# ── Gossip ────────────────────────────────────────────────────────────────────

class GossipAlgorithm:
    """
    Probabilistic epidemic replication.
    Each packet is forwarded with probability `fwd_prob` (default 0.70).
    """

    name = "gossip"

    def __init__(self, fwd_prob: float = 0.70):
        self.fwd_prob = fwd_prob

    def exchange(self, a: DroneNode, b: DroneNode, _t: int, metrics: dict):
        for did in list(set(b.data_items) - set(a.data_items)):
            if random.random() < self.fwd_prob:
                _transfer(b, a, did, metrics)
        for did in list(set(a.data_items) - set(b.data_items)):
            if random.random() < self.fwd_prob:
                _transfer(a, b, did, metrics)

    def maybe_initiate_snapshot(self, drone: DroneNode, _t: int):
        pass


# ── EMRT (Enhanced Message Replication Technique) ────────────────────────────

class EMRTAlgorithm:
    """
    Enhanced Message Replication Technique (Hasan et al., 2023).

    Spray-and-Wait variant where the copy budget L is computed dynamically
    per encounter based on four node-condition factors:

        Factor 1 — Connectivity  : fewer neighbours  → more copies needed
        Factor 2 — Energy        : higher battery    → can afford more copies
        Factor 3 — Buffer usage  : more free buffer  → can store more copies
        Factor 4 — Encounter rate: denser encounters → fewer copies needed

    L_dynamic = clamp(L_base + Δconn + Δenergy + Δbuffer + Δhistory, 1, L_max)

    All L values used are recorded in self.l_history for later analysis.
    """

    name = "emrt"
    L_BASE = 3
    L_MIN  = 1
    L_MAX  = 10

    def __init__(self):
        self.l_history: list = []   # every L value that was applied

    # ── Dynamic L calculation ─────────────────────────────────────────────

    def calculate_dynamic_l(self, drone: DroneNode, t: int) -> int:
        delta = 0

        # Factor 1: Connectivity
        conn = drone.connectivity_count
        if conn == 0:
            delta += 2    # isolated — need many copies
        elif conn <= 2:
            delta += 0    # medium density — no change
        else:
            delta -= 1    # dense — rely on frequent meetings

        # Factor 2: Energy
        batt = drone.battery
        if batt > 70:
            delta += 1    # plenty of power
        elif batt < 30:
            delta -= 1    # conserve energy

        # Factor 3: Buffer usage
        buf_pct = len(drone.data_items) / drone.MAX_DATA * 100
        if buf_pct > 80:
            delta -= 2    # nearly full — no room for more copies
        elif buf_pct > 50:
            delta -= 1    # getting tight

        # Factor 4: Encounter history (encounter rate = total / time)
        enc_rate = drone.total_encounters / max(t, 1)
        if enc_rate > 0.5:
            delta -= 1    # node meets others very often — reduce copies
        elif enc_rate < 0.1:
            delta += 1    # rare meetings — extra copies improve coverage

        return max(self.L_MIN, min(self.L_MAX, self.L_BASE + delta))

    # ── Exchange ──────────────────────────────────────────────────────────

    def exchange(self, a: DroneNode, b: DroneNode, t: int, metrics: dict):
        a.total_encounters += 1
        b.total_encounters += 1

        self._spray(a, b, t, metrics)
        self._spray(b, a, t, metrics)

    def _spray(self, src: DroneNode, dst: DroneNode, t: int, metrics: dict):
        l_dynamic = self.calculate_dynamic_l(src, t)
        for did, item in list(src.data_items.items()):
            if did in dst.data_items:
                continue
            copies = src.spray_copies.get(did, 1)
            if copies <= 1:
                continue   # wait phase
            # Give min(give, l_dynamic // 2) copies so we respect dynamic budget
            give = min(copies // 2, max(1, l_dynamic // 2))
            keep = copies - give
            src.spray_copies[did] = keep
            if _transfer(src, dst, did, metrics):
                dst.spray_copies[did] = give
                self.l_history.append(l_dynamic)
                metrics.setdefault("emrt_l_values", []).append(l_dynamic)

    def maybe_initiate_snapshot(self, drone: DroneNode, _t: int):
        pass


# ── Direct Delivery (no inter-drone exchange) ─────────────────────────────────

class DirectDelivery:
    """No inter-drone data exchange; drones carry data to base station only."""

    name = "direct"

    def exchange(self, a: DroneNode, b: DroneNode, t: int, metrics: dict):
        pass

    def maybe_initiate_snapshot(self, drone: DroneNode, _t: int):
        pass


# ── Registry ──────────────────────────────────────────────────────────────────

def get_algorithm(name: str):
    """Return an algorithm instance by name string."""
    registry = {
        "aerosnap":  None,           # imported in simulation_engine to avoid circular
        "epidemic":  EpidemicAlgorithm,
        "spray_wait": SprayWaitAlgorithm,
        "prophet":   PRoPHETAlgorithm,
        "basic":     BasicReplication,
        "gossip":    GossipAlgorithm,
        "direct":    DirectDelivery,
        "emrt":      EMRTAlgorithm,
    }
    cls = registry.get(name)
    if cls is None:
        raise ValueError(f"Unknown algorithm: {name!r}")
    return cls()
