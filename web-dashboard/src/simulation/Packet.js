export class DataPacket {
  constructor(id, priority, ttl = 500) {
    this.id = id;
    this.priority = priority;    // Importance (0.0 - 1.0)
    this.ttl = ttl;              // Time-to-live (ticks before expiry)
    this.sourceId = null;        // Originating drone ID
    this.delivered = false;
    this.hops = 0;               // Number of times replicated
    this.timestamp = 0;          // Logical timestamp for AeroSnap conflict resolution
  }
}
