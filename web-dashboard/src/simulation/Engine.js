import { Drone } from './Drone';
import { DataPacket } from './Packet';

export class SimulationEngine {
  constructor(numDrones = 14, strategy = "aerosnap", failureRate = 0.00005) {
    this.mapWidth  = 100;
    this.mapHeight = 100;
    this.base      = { x: 0, z: 0, range: 10 };

    this.strategy    = strategy;
    this.failureRate = failureRate;
    this.snapshotInterval = 25;

    this.time             = 0;
    this.deliveredPackets = new Set();
    this.totalTransmissions = 0;
    this.logs             = [];
    this.activeEncounters = [];

    // ── AeroSnap state ────────────────────────────────────────────
    this.snapshotRipples  = [];
    this.totalMarkersSent = 0;
    this.snapshotCount    = 0;
    this.prunedPackets    = 0;  // packets pruned via snapshot delivery awareness

    // ── EMRT state ────────────────────────────────────────────────
    this.emrtLValues = [];   // record every dynamic-L used (for histogram)

    // ── General packet lifecycle ──────────────────────────────────
    this.ttlExpired = 0;     // packets that expired before delivery

    // ── Spray-and-Wait / EMRT: L=8 initial copy budget ────────────
    this.SPRAY_L = 8;

    // ── PRoPHET parameters ────────────────────────────────────────
    this.P_INIT = 0.75;
    this.BETA   = 0.25;
    this.GAMMA  = 0.999;

    // Drones
    this.drones = Array.from({ length: numDrones }, (_, i) =>
      new Drone(
        `D${i + 1}`,
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 100,
        50 + Math.random() * 50,
      )
    );

    // Initialise per-drone Spray copy budgets and PRoPHET predictability
    this.sprayCopies  = {};   // { droneId: { packetId: copies } }
    this.prophPred    = {};   // { droneId: { destDroneId: prob } }
    this.prophLastEnc = {};   // { droneId: { otherDroneId: tick } }

    this.drones.forEach(d => {
      this.sprayCopies[d.id]  = {};
      this.prophPred[d.id]    = {};
      this.prophLastEnc[d.id] = {};
      this.drones.forEach(o => {
        this.prophPred[d.id][o.id]    = 0;
        this.prophLastEnc[d.id][o.id] = 0;
      });
      // BASE is the delivery destination — PRoPHET routes toward it
      this.prophPred[d.id]['BASE']    = 0;
      this.prophLastEnc[d.id]['BASE'] = 0;
    });

    this.totalPacketsGenerated = 0;
    this.recoveredImages = [];
    this.subscribers = [];
  }

  subscribe(cb)  { this.subscribers.push(cb); return () => { this.subscribers = this.subscribers.filter(s => s !== cb); }; }
  notify()       { this.subscribers.forEach(cb => cb(this.getState())); }

  logEvent(msg, type = "info") {
    this.logs.unshift({ time: this.time, msg, type, id: Math.random() });
    if (this.logs.length > 40) this.logs.pop();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Packet copy helper (prevents shared-reference bugs)
  // ═══════════════════════════════════════════════════════════════════════

  _copyPacket(p) {
    const c = new DataPacket(p.id, p.priority, p.ttl);
    c.timestamp = p.timestamp;
    c.hops      = p.hops;
    c.delivered = p.delivered;
    c.sourceId  = p.sourceId;
    return c;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Strategy implementations
  // ═══════════════════════════════════════════════════════════════════════

  /* 1. Epidemic — flood everything on contact */
  epidemicExchange(a, b) {
    let changed = false;
    const aIds = new Set(a.packets.map(p => p.id));
    const bIds = new Set(b.packets.map(p => p.id));

    b.packets.forEach(p => {
      if (!aIds.has(p.id) && a.packets.length < 20) {
        const copy = this._copyPacket(p); copy.hops++;
        a.packets.push(copy);
        a.battery = Math.max(0, a.battery - 0.001);
        b.battery = Math.max(0, b.battery - 0.001);
        this.totalTransmissions++; changed = true;
      }
    });
    a.packets.forEach(p => {
      if (!bIds.has(p.id) && b.packets.length < 20) {
        const copy = this._copyPacket(p); copy.hops++;
        b.packets.push(copy);
        a.battery = Math.max(0, a.battery - 0.001);
        b.battery = Math.max(0, b.battery - 0.001);
        this.totalTransmissions++; changed = true;
      }
    });
    return changed;
  }

  /* 2. Spray-and-Wait — L=8, halve copies on forward */
  sprayWaitExchange(a, b) {
    let changed = false;
    const trySpray = (src, dst) => {
      const dstIds = new Set(dst.packets.map(p => p.id));
      src.packets.forEach(p => {
        if (dstIds.has(p.id) || dst.packets.length >= 20) return;
        const copies = this.sprayCopies[src.id][p.id] ?? 1;
        if (copies <= 1) return;    // wait phase — only deliver to base
        const give = Math.floor(copies / 2);
        const keep = copies - give;
        this.sprayCopies[src.id][p.id] = keep;
        const copy = this._copyPacket(p); copy.hops++;
        dst.packets.push(copy);
        this.sprayCopies[dst.id][p.id] = give;
        src.battery = Math.max(0, src.battery - 0.001);
        dst.battery = Math.max(0, dst.battery - 0.001);
        this.totalTransmissions++; changed = true;
      });
    };
    trySpray(a, b);
    trySpray(b, a);
    return changed;
  }

  /* 3. PRoPHET — forward to drone with higher P(reaching BASE) */
  prophetExchange(a, b) {
    let changed = false;
    const aliveDroneIds = this.drones.filter(d => d.alive).map(d => d.id);
    const allDestIds = [...aliveDroneIds, 'BASE'];

    // Age all predictions including BASE
    [a, b].forEach(d => {
      allDestIds.forEach(nid => {
        const elapsed = this.time - (this.prophLastEnc[d.id][nid] ?? 0);
        this.prophPred[d.id][nid] = (this.prophPred[d.id][nid] ?? 0) * Math.pow(this.GAMMA, elapsed);
      });
    });

    // Encounter update between a and b
    const updateEnc = (me, other) => {
      const old = this.prophPred[me.id][other.id] ?? 0;
      this.prophPred[me.id][other.id] = old + (1 - old) * this.P_INIT;
      this.prophLastEnc[me.id][other.id] = this.time;
      // Transitivity toward BASE through the other drone
      const viaBase = (this.prophPred[me.id][other.id] ?? 0) * (this.prophPred[other.id]['BASE'] ?? 0) * this.BETA;
      if (viaBase > (this.prophPred[me.id]['BASE'] ?? 0))
        this.prophPred[me.id]['BASE'] = viaBase;
      // Transitivity toward other drones
      aliveDroneIds.forEach(nid => {
        if (nid === me.id) return;
        const via = (this.prophPred[me.id][other.id] ?? 0) * (this.prophPred[other.id][nid] ?? 0) * this.BETA;
        if (via > (this.prophPred[me.id][nid] ?? 0))
          this.prophPred[me.id][nid] = via;
      });
    };
    updateEnc(a, b); updateEnc(b, a);

    // Forward: give packet to drone with higher P(BASE)
    const forward = (src, relay) => {
      const relayIds = new Set(relay.packets.map(p => p.id));
      src.packets.forEach(p => {
        if (relayIds.has(p.id) || relay.packets.length >= 20) return;
        const srcP   = this.prophPred[src.id]['BASE']   ?? 0;
        const relayP = this.prophPred[relay.id]['BASE'] ?? 0;
        if (relayP > srcP) {
          const copy = this._copyPacket(p); copy.hops++;
          relay.packets.push(copy);
          src.battery   = Math.max(0, src.battery   - 0.001);
          relay.battery = Math.max(0, relay.battery - 0.001);
          this.totalTransmissions++; changed = true;
        }
      });
    };
    forward(a, b); forward(b, a);
    return changed;
  }

  /* 4. EMRT — dynamic Spray-and-Wait, L based on 5 factors including TTL urgency */
  emrtExchange(a, b) {
    let changed = false;
    const tryEmrt = (src, dst) => {
      const dstIds = new Set(dst.packets.map(p => p.id));
      src.packets.forEach(p => {
        if (dstIds.has(p.id) || dst.packets.length >= 20) return;
        const copies = this.sprayCopies[src.id][p.id] ?? 1;
        if (copies <= 1) return;
        const dynL = this._emrtDynamicL(src, p);
        const give = Math.min(Math.floor(copies / 2), Math.max(1, Math.floor(dynL / 2)));
        const keep = copies - give;
        this.sprayCopies[src.id][p.id] = keep;
        const copy = this._copyPacket(p); copy.hops++;
        dst.packets.push(copy);
        this.sprayCopies[dst.id][p.id] = give;
        src.battery = Math.max(0, src.battery - 0.001);
        dst.battery = Math.max(0, dst.battery - 0.001);
        this.totalTransmissions++; changed = true;
        this.emrtLValues.push(dynL);
      });
    };
    tryEmrt(a, b); tryEmrt(b, a);
    return changed;
  }

  _emrtDynamicL(drone, packet) {
    let delta = 0;
    // Factor 1: connectivity
    const conn = this.drones.filter(d => d.alive && d.id !== drone.id && drone.distanceTo(d.x, d.z) < 15).length;
    if      (conn === 0) delta += 2;
    else if (conn >= 3)  delta -= 1;
    // Factor 2: energy
    if      (drone.battery > 70) delta += 1;
    else if (drone.battery < 30) delta -= 1;
    // Factor 3: buffer
    const bufPct = drone.packets.length / 20 * 100;
    if      (bufPct > 80) delta -= 2;
    else if (bufPct > 50) delta -= 1;
    // Factor 4: encounter rate
    const encRate = (drone.totalEncounters ?? 0) / Math.max(this.time, 1);
    if      (encRate > 0.5) delta -= 1;
    else if (encRate < 0.1) delta += 1;
    // Factor 5: TTL urgency — replicate more aggressively as TTL runs low
    if (packet?.ttl != null) {
      const ttlRatio = packet.ttl / 500;
      if      (ttlRatio < 0.2) delta += 3;
      else if (ttlRatio < 0.5) delta += 1;
    }
    return Math.max(1, Math.min(10, 8 + delta));
  }

  /* 5. Gossip — probabilistic 70% forwarding */
  gossipExchange(a, b) {
    let changed = false;
    const aIds = new Set(a.packets.map(p => p.id));
    const bIds = new Set(b.packets.map(p => p.id));
    b.packets.forEach(p => {
      if (!aIds.has(p.id) && a.packets.length < 20 && Math.random() < 0.7) {
        const copy = this._copyPacket(p); copy.hops++;
        a.packets.push(copy);
        a.battery = Math.max(0, a.battery - 0.001);
        b.battery = Math.max(0, b.battery - 0.001);
        this.totalTransmissions++; changed = true;
      }
    });
    a.packets.forEach(p => {
      if (!bIds.has(p.id) && b.packets.length < 20 && Math.random() < 0.7) {
        const copy = this._copyPacket(p); copy.hops++;
        b.packets.push(copy);
        a.battery = Math.max(0, a.battery - 0.001);
        b.battery = Math.max(0, b.battery - 0.001);
        this.totalTransmissions++; changed = true;
      }
    });
    return changed;
  }

  /* 6. AeroSnap — Chandy-Lamport markers + priority-gated replication */
  aeroSnapExchange(a, b) {
    let hadExchange = false;
    let snapshotExchange = false;

    if (a.snapshot && !a.markerSentTo.has(b.id)) {
      b.mergeSnapshot(a.snapshot);
      a.markerSentTo.add(b.id);
      this.totalMarkersSent++;
      snapshotExchange = true;
      this.logEvent(`${a.id}→${b.id} MARKER (snapshot merge)`, 'snapshot');
    }
    if (b.snapshot && !b.markerSentTo.has(a.id)) {
      a.mergeSnapshot(b.snapshot);
      b.markerSentTo.add(a.id);
      this.totalMarkersSent++;
      snapshotExchange = true;
      this.logEvent(`${b.id}→${a.id} MARKER (snapshot merge)`, 'snapshot');
    }
    if (snapshotExchange) {
      this.snapshotRipples.push({ x: (a.x + b.x) / 2, y: Math.max(a.y, b.y), z: (a.z + b.z) / 2, type: 'merge', time: this.time, id: Math.random() });

      // Prune packets both drones now know are already delivered
      [a, b].forEach(drone => {
        const knownDelivered = drone.deliveredIds;
        if (!knownDelivered.size) return;
        const before = drone.packets.length;
        drone.packets = drone.packets.filter(p => !knownDelivered.has(p.id));
        const pruned = before - drone.packets.length;
        if (pruned > 0) {
          this.prunedPackets += pruned;
          this.logEvent(`${drone.id} pruned ${pruned} delivered packet(s) via snapshot`, 'snapshot');
        }
      });
    }

    // Priority-gated replication with snapshot-aware delivery checks
    const tryAero = (src, dst) => {
      const dstIds = new Set(dst.packets.map(p => p.id));
      const knownDelivered = new Set([...src.deliveredIds, ...dst.deliveredIds]);
      src.packets.forEach(p => {
        if (dstIds.has(p.id) || dst.packets.length >= 20) return;
        if (p.priority < 0.4) return;
        if (knownDelivered.has(p.id)) return;              // already delivered, skip
        if (dst.snapshot?.dataIds?.has(p.id)) return;      // dst already has it per snapshot
        const copies = this.sprayCopies[src.id][p.id] ?? 1;
        if (copies <= 1) return;
        const give = Math.floor(copies / 2);
        this.sprayCopies[src.id][p.id] = copies - give;
        const copy = this._copyPacket(p); copy.hops++;
        dst.packets.push(copy);
        this.sprayCopies[dst.id][p.id] = give;
        dst.tickClock();
        src.battery = Math.max(0, src.battery - 0.001);
        dst.battery = Math.max(0, dst.battery - 0.001);
        this.totalTransmissions++; hadExchange = true;
      });
    };
    tryAero(a, b); tryAero(b, a);

    return hadExchange || snapshotExchange;
  }

  /* 7. Direct delivery — no inter-drone exchange */
  directExchange(_a, _b) { return false; }

  // ═══════════════════════════════════════════════════════════════════════
  // Partition detection (BFS connected components)
  // ═══════════════════════════════════════════════════════════════════════

  detectPartitions() {
    const alive = this.drones.filter(d => d.alive);
    const visited = new Set();
    const partitions = [];
    for (const drone of alive) {
      if (visited.has(drone.id)) continue;
      const part = [];
      const queue = [drone];
      while (queue.length) {
        const cur = queue.shift();
        if (visited.has(cur.id)) continue;
        visited.add(cur.id); part.push(cur.id);
        alive.forEach(o => { if (!visited.has(o.id) && cur.distanceTo(o.x, o.z) < 15) queue.push(o); });
      }
      partitions.push(part);
    }
    return partitions;
  }

  calculateConvergence() {
    const alive = this.drones.filter(d => d.alive && d.snapshot);
    if (!alive.length) return 0;
    const avg = alive.reduce((s, d) => s + d.snapshot.knownNodes.size, 0) / alive.length;
    return Math.round((avg / this.drones.length) * 100);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Main simulation step
  // ═══════════════════════════════════════════════════════════════════════

  step() {
    this.time++;
    this.activeEncounters = [];
    this.snapshotRipples = this.snapshotRipples.filter(r => this.time - r.time < 30);

    const allIds = this.drones.map(d => d.id);

    // 1. Move & capture data
    this.drones.forEach(d => {
      if (!d.alive) return;
      const wasScanning = d.isScanning;
      d.move();

      if (wasScanning && !d.isScanning && Math.random() > 0.2) {
        this.totalPacketsGenerated++;
        const pId = `IMG-${this.totalPacketsGenerated}`;
        const p   = new DataPacket(pId, parseFloat((0.3 + Math.random() * 0.7).toFixed(2)));
        p.timestamp  = this.time;
        p.sourceId   = d.id;
        d.packets.push(p);
        d.tickClock();
        // Initialise copy budget for this new packet across all algorithms
        this.drones.forEach(o => { if (!this.sprayCopies[o.id]) this.sprayCopies[o.id] = {}; });
        this.sprayCopies[d.id][pId] = this.SPRAY_L;
        this.logEvent(`${d.id} captured ${pId} (P=${p.priority})`, 'info');
      }

      if (Math.random() < this.failureRate) {
        d.alive = false;
        const lost = d.packets.length;
        d.packets = []; d.snapshot = null;
        this.logEvent(`Node ${d.id} FAILED (${lost} images lost)`, 'error');
      }
    });

    const alive = this.drones.filter(d => d.alive);

    // 2a. TTL expiry — drop packets that ran out of time
    alive.forEach(d => {
      d.packets = d.packets.filter(p => {
        if (p.ttl == null) return true;
        p.ttl--;
        if (p.ttl <= 0) { this.ttlExpired++; return false; }
        return true;
      });
    });

    // 2b. PRoPHET BASE encounter — drones near base gain P(BASE) experience
    if (this.strategy === 'prophet') {
      alive.forEach(d => {
        if (d.distanceTo(this.base.x, this.base.z) < this.base.range) {
          const old = this.prophPred[d.id]['BASE'] ?? 0;
          this.prophPred[d.id]['BASE'] = old + (1 - old) * this.P_INIT;
          this.prophLastEnc[d.id]['BASE'] = this.time;
        }
      });
    }

    // 2c. Base station deliveries — clear buffer after delivery
    alive.forEach(d => {
      if (d.distanceTo(this.base.x, this.base.z) >= this.base.range) return;
      const toDeliver = d.packets.filter(p => !p.delivered && !this.deliveredPackets.has(p.id));
      toDeliver.forEach(p => {
        p.delivered = true;
        this.deliveredPackets.add(p.id);
        d.markDelivered(p.id);  // propagate delivery awareness via snapshots
        this.recoveredImages.push({ id: p.id, priority: p.priority, time: this.time });
        d.updateReliability(true);
        this.logEvent(`${d.id} DELIVERED ${p.id} TO BASE`, 'success');
      });
      d.packets = [];   // clear buffer — frees space for new data
    });

    // 3. Snapshot initiation (AeroSnap only — adaptive frequency)
    if (this.strategy === 'aerosnap') {
      alive.forEach(d => {
        const conn  = alive.filter(o => o.id !== d.id && d.distanceTo(o.x, o.z) < 15).length;
        const freq  = conn >= 3 ? 15 : conn >= 1 ? 25 : 40;
        const since = this.time - (d._lastSnapshotTime ?? 0);
        if (since >= freq) {
          d.initiateSnapshot(this.time, allIds);
          d._lastSnapshotTime = this.time;
          this.snapshotCount++;
          this.snapshotRipples.push({ x: d.x, y: d.y, z: d.z, type: 'initiate', time: this.time, id: Math.random() });
          this.logEvent(`${d.id} initiated snapshot #${d.snapshotsInitiated}`, 'snapshot');
        }
      });
    }

    // 4. Encounters — strategy dispatch
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        if (a.distanceTo(b.x, b.z) >= 15) continue;

        // Track total encounters per drone (for EMRT)
        a.totalEncounters = (a.totalEncounters ?? 0) + 1;
        b.totalEncounters = (b.totalEncounters ?? 0) + 1;

        let replicated = false;
        switch (this.strategy) {
          case 'epidemic':   replicated = this.epidemicExchange(a, b);    break;
          case 'spray_wait': replicated = this.sprayWaitExchange(a, b);   break;
          case 'prophet':    replicated = this.prophetExchange(a, b);     break;
          case 'emrt':       replicated = this.emrtExchange(a, b);        break;
          case 'gossip':     replicated = this.gossipExchange(a, b);      break;
          case 'aerosnap':   replicated = this.aeroSnapExchange(a, b);    break;
          case 'direct':     replicated = this.directExchange(a, b);      break;
        }
        if (replicated) this.activeEncounters.push([a.id, b.id]);
      }
    }

    this.notify();
    return { activeEncounters: this.activeEncounters };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // State export
  // ═══════════════════════════════════════════════════════════════════════

  getState() {
    const surv = this.totalPacketsGenerated > 0
      ? (this.deliveredPackets.size / this.totalPacketsGenerated * 100).toFixed(1)
      : 0;
    const partitions  = this.detectPartitions();
    const convergence = this.calculateConvergence();

    // EMRT: avg dynamic-L used
    const emrtAvgL = this.emrtLValues.length
      ? (this.emrtLValues.reduce((a, b) => a + b, 0) / this.emrtLValues.length).toFixed(2)
      : null;

    return {
      drones: this.drones,
      logs:   this.logs,
      activeEncounters: this.activeEncounters,
      snapshotRipples:  this.snapshotRipples,
      recoveredImages:  this.recoveredImages,
      partitions,
      metrics: {
        survivability:  surv,
        overhead:       this.deliveredPackets.size > 0
          ? (this.totalTransmissions / this.deliveredPackets.size).toFixed(2) : 0,
        transmissions:  this.totalTransmissions,
        delivered:      this.deliveredPackets.size,
        totalPackets:   this.totalPacketsGenerated,
        aliveNodes:     this.drones.filter(d => d.alive).length,
        totalNodes:     this.drones.length,
        markersSent:    this.totalMarkersSent,
        snapshotCount:  this.snapshotCount,
        convergence,
        partitionCount: partitions.length,
        time:           this.time,
        emrtAvgL,
        emrtSamples:    this.emrtLValues.length,
        ttlExpired:     this.ttlExpired,
        prunedPackets:  this.prunedPackets,
      },
    };
  }
}
