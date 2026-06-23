# Event-Driven Perpetual Futures Matching Engine [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/tannu13/perp-v2)

A high-performance, fault-tolerant, and event-driven perpetual futures trading platform architecture. This repository implements a decoupled, distributed microservices system designed around an in-memory matching engine utilizing Redis Streams for asynchronous, high-throughput message bus communication. The services can run either as local Bun processes or as containerized workloads on a Kubernetes cluster.

---

## System Architecture

The ecosystem consists of several specialized microservices interacting seamlessly via an event-driven loop:
![alt text](perps-v2-system-design.png)

- **API Backend:** Handles user authenticated requests (orders, margin allocations, account retrievals) and pushes incoming transaction payloads directly into an upstream Redis stream pipeline.
- **In-Memory Matching Engine:** The low-latency core of the exchange. It operates entirely in memory to achieve sub-millisecond transaction execution, handling limit/market order matching, dynamic margin verification, position tracking, and real-time PnL metrics.
- **Idempotent DB Writer:** A decoupled consumer service listening to the engine's reply streams. It safely updates historical transaction logs and position states into a relational disk database, preventing duplicate entries during recovery replay cycles.
- **Websocket Server:** Subscribes to execution and book update streams to instantly broadcast real-time market data, tick streams, and order fill statuses directly to front-end clients.
- **Kubernetes Runtime:** Each service has a Docker image definition under `ops/` and Kubernetes deployment/service manifests under `k8s/`. Public traffic is routed through an NGINX ingress to `/api` and `/ws`.

---

## Architectural Deep Dives & Trade-offs

To achieve sub-millisecond execution while maintaining rigorous financial consistency, the system explicitly favors determinism over horizontal scalability of the engine instance.

### 1. Single-Instance Determinism vs. Multiple-Instance With Shared State

The In-Memory Matching Engine intentionally processes all market tickers sequentially through a single stream instance vs one market pair per engine instance as even in that case the user's balances would need to be shared among the instances and would require some sort of distributed lock contention on the balances. It wouldn't guarantee absolute determinism during crash recovery replays. For example - in first case some orders happened in one market and others rejected due to low balance because balance was reduced due to the first trade. In this case replaying the events, after a crash across multiple instances, might finalize in different orders being executed as another instance might be faster in this iteration vs in the actual series of events and might end up with different states of balances and could execute different trades.

### 2. End-to-End Idempotency (Application vs. Transport Layer)

To prevent duplicate state mutations during network retries or engine crashes, an exact-once processing semantic is enforced at the database layer. This is implemented by generating a correlation id at the origin of the request. I did not use redis stream message id because that'd be a transport layer id and might not survive retries by sender services in case of a crash or a timeout. I thought, because correlation id is generated at the source so it represents that action done by the user. Replaying it any number of times would still keep it same. Then this id is used in a transaction in the db writer service on a unique key col so that if that fails, all the related inserts & updates are skipped.

---

## Key Operational Features

### 1. High Availability & Disaster Recovery (S3 Snapshots + Stream Replay)

To preserve maximum throughput without risking state loss, the in-memory matching engine is backed by an automated state-recovery mechanism:

- A dedicated **Cron Scheduler** via BullMQ dispatches a snapshot event every 15 minutes, prompting the matching engine to serialize its entire state and backup an immutable snapshot to an **Amazon S3** bucket (for local dev, have implemented minio via docker container).
- Upon unexpected failure or system restart, the engine initializes by pulling the latest S3 snapshot and immediately replays the subsequent Redis Stream offset to cleanly reconstruct its state to the exact millisecond before termination.

### 2. Automated Funding Rate Mechanics

The central scheduling service dispatches deterministic funding rate calculation and dispersal events into the engine every hour. The engine seamlessly applies floating funding premiums across open positions to keep the perpetual contract price tightly tethered to the underlying spot asset index.

### 3. Real-Time Liquidation Monitoring via Binance Spot Feed

A dedicated **Price Poller** service maintains an uninterrupted connection to Binance's WebSocket server to ingest premium spot index prices. It continuously feeds these oracle ticks directly into the engine, allowing it to dynamically evaluate open position maintenance margins and instantly execute automated liquidations if bankruptcy parameters are crossed.

### 4. Kubernetes-Ready Deployment

The repo now includes Kubernetes manifests for running the microservices as cluster workloads:

- `ops/*.Dockerfile` builds one image per service.
- `k8s/*.yaml` defines the deployments and the services required by externally reachable workloads.
- `k8s/ingress.yaml` configures NGINX ingress routing for `/api` -> `backend-service:3000` and `/ws` -> `ws-server-service:3010`.

The checked-in manifests currently use Docker Hub images and, for local Minikube development, connect back to host-provided Postgres, Redis, and MinIO through `host.minikube.internal`.

#### Run Locally on Minikube

Prerequisites: Docker, Minikube, `kubectl`, and Docker Compose.

1. Start the backing services on the host:

```bash
docker compose up -d db redis minio
```

2. Create/apply the local database schema before starting the app workloads:

```bash
DATABASE_URL=postgresql://perps_user:mysecretpasswordfordb@localhost:5432/perps_db bun --filter @repo/db run db:migrate
```

3. Start Minikube and enable the NGINX ingress controller:

```bash
minikube start
minikube addons enable ingress
```

4. Apply the Kubernetes manifests:

```bash
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/engine.yaml
kubectl apply -f k8s/db-writer.yaml
kubectl apply -f k8s/scheduler.yaml
kubectl apply -f k8s/price-poller.yaml
kubectl apply -f k8s/ws-server.yaml
kubectl apply -f k8s/ingress.yaml
```

5. Run the Minikube tunnel in a separate terminal:

```bash
minikube tunnel
```

6. Verify the workloads and ingress:

```bash
kubectl get pods -n perps-app
kubectl get ingress -n perps-app
```

Once the ingress has an address, the backend is available at `http://<ingress-address>/api` and the websocket server at `ws://<ingress-address>/ws`.

For local snapshot backups, create the MinIO bucket named in `k8s/engine.yaml` before snapshot events run. The default local MinIO console is available at `http://localhost:9001` with `fake-local-key` / `fake-local-secret`.

For a cloud provider, keep the same service layout and replace the local-only values with managed infrastructure endpoints, registry/image tags, and cluster-managed secrets/config maps.
