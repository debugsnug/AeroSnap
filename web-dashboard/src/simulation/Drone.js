export class Drone {
  constructor(id, x, z, battery) {
    this.id = id;
    this.x = x;
    this.z = z;
    this.y = 8 + Math.random() * 6; // Hovering altitude between 8-14
    this.battery = battery;
    this.alive = true;
    this.packets = []; // Currently carried images

    // Stats for reliability learning
    this.successful_deliveries = 1;
    this.total_interactions = 2;
    this.reliability = 0.5;

    // Movement
    this.speed = 0.5 + Math.random() * 0.5;
    this.target = this.getRandomTarget();
    this.pause = 0;

    // Scanning Logic
    this.isScanning = false;
    this.scanTimer = 0;

    // ═══ AeroSnap: Vector Clock ═══
    this.vectorClock = {};
    this.vectorClock[id] = 0;

    // ═══ AeroSnap: Snapshot State (Modified Chandy-Lamport) ═══
    this.snapshot = null;          // { vectorClock, dataIds<Set>, knownNodes<Set>, time, mergedCount }
    this.markerSentTo = new Set(); // track which drones received our marker
    this.snapshotsInitiated = 0;
    this.snapshotsMerged = 0;

    // Delivery awareness — propagated via snapshot merges
    this.deliveredIds = new Set();
  }

  getRandomTarget() {
    return {
      x: (Math.random() - 0.5) * 100,
      z: (Math.random() - 0.5) * 100,
      y: 8 + Math.random() * 6
    };
  }

  distanceTo(x, z) {
    return Math.hypot(this.x - x, this.z - z);
  }

  move() {
    if (!this.alive) {
      if (this.y > 0) this.y -= 0.5; // fall gently
      if (this.y < 0) this.y = 0;
      return;
    }

    if (this.pause > 0) {
      this.pause -= 1;
      return;
    }

    // Scanning behavior
    if (this.isScanning) {
      this.scanTimer -= 1;
      this.battery = Math.max(0, this.battery - 0.05);
      if (this.scanTimer <= 0) {
        this.isScanning = false;
      }
      return;
    }

    let dx = this.target.x - this.x;
    let dz = this.target.z - this.z;
    let dy = this.target.y - this.y;
    let dist = Math.hypot(dx, dz, Math.abs(dy));

    if (dist < 2) {
      if (Math.random() < 0.3 && this.packets.length < 5) {
        this.isScanning = true;
        this.scanTimer = 30;
      } else {
        this.pause = Math.floor(Math.random() * 20 + 10);
        this.target = this.getRandomTarget();
      }
    } else {
      this.x += (dx / dist) * this.speed;
      this.z += (dz / dist) * this.speed;
      this.y += (dy / dist) * this.speed;
    }

    this.battery = Math.max(0, this.battery - 0.03);
    if (this.battery <= 0) {
      this.alive = false;
      this.isScanning = false;
    }
  }

  updateReliability(success) {
    if (success) this.successful_deliveries += 1;
    this.total_interactions += 1;
    this.reliability = this.successful_deliveries / this.total_interactions;
  }

  markDelivered(packetId) {
    this.deliveredIds.add(packetId);
    // Also remove from local buffer since it's confirmed delivered
    this.packets = this.packets.filter(p => p.id !== packetId);
  }


  // ═══════════════════════════════════════════════════════════════════════
  // AeroSnap: Vector Clock Operations
  // ═══════════════════════════════════════════════════════════════════════

  tickClock() {
    this.vectorClock[this.id] = (this.vectorClock[this.id] || 0) + 1;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AeroSnap: Snapshot Operations (Modified Chandy-Lamport)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Step 1 & 2: Record local state and prepare to propagate markers.
   */
  initiateSnapshot(time, allDroneIds) {
    this.tickClock();

    // Initialize entries for all known drones
    allDroneIds.forEach(id => {
      if (!(id in this.vectorClock)) this.vectorClock[id] = 0;
    });

    this.snapshot = {
      vectorClock: { ...this.vectorClock },
      dataIds: new Set(this.packets.map(p => p.id)),
      deliveredIds: new Set(this.deliveredIds),
      knownNodes: new Set([this.id]),
      time: time,
      mergedCount: 0,
    };
    this.markerSentTo = new Set();
    this.snapshotsInitiated++;
  }

  /**
   * Step 5: Merge incoming snapshot using vector clock policy.
   *
   *   1. Element-wise max of vector clocks
   *   2. Union of data IDs (dedup by ID)
   *   3. Union of known nodes
   *   4. Conflict resolution: keep latest timestamp (implicit via ID uniqueness)
   */
  mergeSnapshot(incomingSnapshot) {
    // Update own vector clock (element-wise max + tick)
    for (const [nodeId, ts] of Object.entries(incomingSnapshot.vectorClock)) {
      this.vectorClock[nodeId] = Math.max(this.vectorClock[nodeId] || 0, ts);
    }
    this.tickClock();

    // If no local snapshot, create one first
    if (!this.snapshot) {
      this.snapshot = {
        vectorClock: { ...this.vectorClock },
        dataIds: new Set(this.packets.map(p => p.id)),
        deliveredIds: new Set(this.deliveredIds),
        knownNodes: new Set([this.id]),
        time: incomingSnapshot.time,
        mergedCount: 0,
      };
    }

    // Merge vector clocks in snapshot (element-wise max)
    for (const [nodeId, ts] of Object.entries(incomingSnapshot.vectorClock)) {
      this.snapshot.vectorClock[nodeId] = Math.max(
        this.snapshot.vectorClock[nodeId] || 0, ts
      );
    }

    // Union of data IDs
    if (incomingSnapshot.dataIds) {
      incomingSnapshot.dataIds.forEach(id => this.snapshot.dataIds.add(id));
    }

    // Union of delivered IDs and propagate to local awareness
    if (incomingSnapshot.deliveredIds) {
      incomingSnapshot.deliveredIds.forEach(id => {
        this.snapshot.deliveredIds.add(id);
        this.deliveredIds.add(id);  // propagate to live awareness
      });
    }

    // Union of known nodes
    if (incomingSnapshot.knownNodes) {
      incomingSnapshot.knownNodes.forEach(n => this.snapshot.knownNodes.add(n));
    }

    this.snapshot.mergedCount++;
    this.snapshotsMerged++;
  }
}
