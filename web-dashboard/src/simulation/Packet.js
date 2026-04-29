export class DataPacket {
  constructor(id, priority) {
    this.id = id;
    this.priority = priority;    // Importance (0.0 - 1.0)
    this.delivered = false;
    this.hops = 0;               // Number of times replicated
    this.timestamp = 0;          // Logical timestamp for AeroSnap conflict resolution
  }
}
