# AeroSnap: Adaptive Partition-Aware Distributed Snapshot

**Project Title:** Adaptive Partition-Aware Distributed Snapshot with Opportunistic Replication for Drone-Based Disaster Data Collection

---

## 🚁 Overview
AeroSnap is a distributed system designed for reliable data collection in infrastructure-less disaster zones. It coordinates a swarm of drones using an adaptive snapshot algorithm derived from Chandy-Lamport, combined with opportunistic replication and vector clocks for causal ordering.

### Key Features
- **Partition-Aware Snapshots**: Captures global state even when the swarm is split into isolated sub-networks.
- **Adaptive Triggering**: Snapshot frequency scales automatically based on local neighbor density (8/15/25 ticks).
- **Priority-Gated Replication**: High-priority disaster data (IMG/Telemetry) is prioritized for replication.
- **Digital Twin Dashboard**: A high-fidelity React/Three.js command center for real-time monitoring.

---

## ⚙️ Requirements
- **Python 3.10+**
- **Node.js 18+** (for the Dashboard)
- Python Packages: `matplotlib`, `numpy`

---

## 🏃 How to Run

### Part 1: Python Simulation
The simulation engine executes the core algorithms and generates comparative performance plots.

1. **Quick Smoke Test**:
   ```powershell
   python main.py --quick
   ```
2. **Full Evaluation** (Baseline, High-Failure, Partition, Scalability, and Extreme scenarios):
   ```powershell
   python main.py --full
   ```
   *Note: This generates high-quality plots in the `plots/` folder.*

### Part 2: Interactive Web Dashboard
1. **Navigate to the dashboard directory**:
   ```powershell
   cd web-dashboard
   ```
2. **Install dependencies**:
   ```powershell
   npm install
   ```
3. **Launch the dashboard**:
   ```powershell
   npm run dev
   ```
4. **View in browser**: Open [http://localhost:5173](http://localhost:5173)

---

## 📊 Performance Metrics (Current Baseline)
After tuning the simulation to match realistic disaster conditions (0.3% failure/min, 8% packet loss):

| Metric | AeroSnap (Proposed) | Epidemic (Baseline) |
| :--- | :--- | :--- |
| **Delivery Rate (DDR)** | **~87-89%** | ~90-93% |
| **Communication Overhead** | **~3.5x** | ~10.8x |
| **Snapshot Accuracy** | **99.9%** | N/A |
| **Survivability (DSR)** | **99%** | ~92% |

---

## 📁 Project Structure
- `aerosnap_algorithm.py`: Core logic for markers and adaptive snapshots.
- `drone_node.py`: Physical drone modeling (battery, mobility, buffer).
- `simulation_engine.py`: Discrete-event simulator and network partition logic.
- `baseline_algorithms.py`: PRoPHET, Spray-Wait, Epidemic, and Gossip implementations.
- `vector_clock.py`: Causal ordering and event synchronization.
- `web-dashboard/`: React + Three.js + Vite frontend.
