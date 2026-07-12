# Blueprint weights — evidence packet (v0.163.0, V1.1 Flow#5)

**Status: QUARANTINED.** `StarNix.blueprint.WEIGHTS` ships as `null`; exam sims keep the flat
shuffle. The quota mechanism is live, gate-pinned, and activates the moment a ratified table is
pasted in. Nothing here is authoritative until Jason signs off — learning-integrity rule.

## What the official source says

Checked 2026-07-11 against the official **NCP-MCI 6.5 Exam Blueprint Guide**
(`https://www.nutanix.com/content/dam/nutanix/en/resources/misc/ebg-ncp-mci-6-5.pdf`):

- 75 questions, 120 minutes, scaled scoring 1000–6000 (pass 3000).
- Six sections: 1 Manage Cluster/Nodes/Features · 2 Manage Cluster Storage · 3 Configure Cluster
  Networking and Network Security · 4 Analyze and Remediate Performance Issues · 5 Configure,
  Analyze and Remediate Alerts and Events · 6 Manage VM Deployment and Configuration.
- **No per-section weights or question counts are published.** §1.5 says only that "a number of
  questions is determined for each objective, which relates directly to the criticality of the
  task in the job role."

## Candidate proxy (NOT official — needs your ruling)

Unique objectives per section in the same guide, as a weight proxy:

| Official section | Objectives | Proxy share |
|---|---|---|
| 1 Cluster/Nodes/Features | 5 | 22.7% |
| 2 Storage | 2 | 9.1% |
| 3 Networking + NetSec | 3 | 13.6% |
| 4 Performance | 5 | 22.7% |
| 5 Alerts/Events | 3 | 13.6% |
| 6 VM Deployment/Config | 4 | 18.2% |

## What ratification needs

1. Accept/adjust a weight table (the proxy above, or your own from exam experience).
2. Map the 6 official sections onto the bank's 9 house domains (`architecture, storage,
   networking, security, vms, data-protection, lifecycle, monitoring, performance`) — e.g.
   section 3 splits across `networking` + `security`; `data-protection`/`lifecycle` have no
   dedicated official section (they live inside 1 and 6).
3. Paste the final `{ domain: fraction }` table into `StarNix.blueprint.WEIGHTS`
   (starnix-core.js) — sims start quota-filling immediately; the readiness/heatmap weight
   column is a small follow-up once weights exist.
