# NCP-MCI question bank — Exam 1 — REVIEW / QUARANTINE

> **Cert pack:** NCP-MCI · **Source:** TXT.rtf · **Questions:** 9
> **Canonical interchange format** — consumed by both StarNix and WWTBANE.
>
> Stems, options, per-option explanations, the answer key, and the overall explanation are
> **transcribed verbatim from the source exam**. Only `@domain`, `@difficulty`, `@tags` and
> `@briefing` are authored. No answer is generated or inferred.

## Block format

| Field | Meaning |
|---|---|
| `### <id>` | stable unique id, `ncp-mci-<exam>-q<n>` |
| stem | the question text (verbatim), runs until the first option |
| `@image:` / `@image-alt:` | exhibit, placed **after the stem, before the options** — render inline here |
| `- ( )` / `- (x)` | option; `(x)` = correct, taken from the exam's own key |
| `  > ...` | that option's explanation (verbatim) |
| `@overall:` | the exam's overall explanation (verbatim) |
| `@domain:` | one of: architecture, storage, networking, security, vms, data-protection, lifecycle, monitoring, performance |
| `@difficulty:` | 1 = easy · 2 = medium · 3 = hard |
| `@priority:` | optional. higher = served sooner by the scheduler. omit = 0 (normal) |
| `@tags:` | comma-separated |
| `@briefing:` | commander dialogue, <=120 words |
| `@multi:` / `@review:` | quarantine flags — present only in the review file |

---

> **Do not import these into the live bank.** Each needs a human decision.

---

### ncp-mci-e1-q13

An administrator has tasked to configured AHV Metro Availability with Witness and wants to document failover scenarios. As a part of the failover tests, connection losses between these pairs were simulated: - Both the metro pair of clusters. -Primary cluster and Prism Central. However, Prism Central and the recovery cluster are still connected. What are two expected system behaviors in this case? (Choose two.)

- (x) Guest VM I/O operations pause (freeze) until connectivity is restored.
  > Correct; Metro Availability enforces data consistency, so I/O operations pauseuntil failover is confirmed.
- ( ) Guest VM I/O operations pause (freeze) until connectivity between Prism Central and the primary site is restored.
  > Incorrect; Prism Central does not control VM failover in Metro Availability.
- (x) Guest VMs failover automatically to the recovery cluster.
  > Correct; Witness enables automatic failover.
- ( ) Guest VMs continue to run on the primary cluster.
  > Incorrect; the primary cluster is disconnected.

@overall: Witness Initiated Failover: The Witness VM will detect the failure of the primary cluster and automatically initiate a failover to the recovery cluster.
@domain: data-protection
@difficulty: 3
@tags: metro-availability, witness, failover, ahv
@briefing: Twin stations, Metro-linked, with a Witness watching the tether from outside. The metro pair goes silent and the primary loses Prism Central too, but Prism Central still sees the recovery site. Two things follow. Guest I/O freezes: Metro enforces consistency, so operations pause rather than let the two sides diverge. Then the Witness — the arbiter here — triggers automatic failover to the recovery cluster. Prism Central does not make that call. The Witness does. Anything claiming the VMs keep running on a disconnected primary is wishful thinking.
@multi: true
@review: Choose-two. Two correct options; single-answer schema cannot represent this. Decide: support multi-answer natively, reword to one best answer, or merge the pair into one option.

---

### ncp-mci-e1-q17

An administrator is experiencing performance issues within a VM and believes that more vCPUs should be added to the specific VM. The cluster as a whole appears to be performing well. Which two metrics should be analyzed to determine if adding more vCPUs is warranted? (Choose two.)

- (x) VM CPU Ready Time
  > Correct, High CPU Ready Time indicates CPU contention, meaning adding vCPUs may not help.
- (x) VM CPU Usage
  > Correct, If CPU usage is consistently high, adding more vCPUs may improve performance.
- ( ) Host CPU Usage
  > Incorrect, Host CPU usage provides insight but does not determine VM CPU needs directly.
- ( ) Host Memory Swap Out Rate
  > Incorrect, This metric relates to memory, not CPU performance.

@overall: To determine whether adding more virtual CPUs (vCPUs) would improve the virtual machine's (VM) performance, the administrator should analyze these two metrics: CPU Ready Time: This metric indicates the amount of time a VM has to wait for available physical CPU resources. High CPU ready times suggest that the VM is experiencing CPU contention and could benefit from additional vCPUs. CPU Usage: While high CPU usage alone doesn't necessarily mean adding more vCPUs will help, it's important to analyze it in conjunction with CPU ready time. If CPU usage is high and CPU ready time is high, it strongly suggests that the VM is CPU constrained and could benefit from additional vCPUs. If, however, CPU usage is low, adding more vCPUs is unlikely to improve performance. Adding vCPUs won't resolve performance issues if the VM isn't already using all of its available CPU resources.
@domain: performance
@difficulty: 2
@tags: cpu-ready-time, cpu-usage, vcpu, right-sizing
@briefing: Before you hand a VM more vCPUs, prove it needs them, and prove it from the VM's own numbers. CPU Usage tells you whether the vCPUs it already has are pegged. CPU Ready Time tells you whether the host is starving it of physical CPU. High usage with low ready time means the machine is genuinely saturated: give it more. High ready time means the host is contended, and adding vCPUs will make it worse, not better. The cluster looks healthy overall — that average tells you nothing about this one machine.
@multi: true
@review: Choose-two. Two correct options. Same decision as Q13.

---

### ncp-mci-e1-q27

An administrator needs to enable application discovery on a Nutanix cluster to monitor applications. A Prism Central instance is already configured and meets the licensing, CPU and memory requirements. What two other prerequisites must be met before enabling application discovery? (Choose two.)

- ( ) Network controller is enabled
  > Incorrect, Not required for application discovery.
- (x) API key and key ID
  > Correct, Required to authenticate and enable application discovery.
- (x) Internet connection
  > Correct, Required to fetch application metadata.
- ( ) Sufficient Prism Central VM resources
  > Incorrect, Already mentioned as sufficient in the question.

@overall: The prerequisites for enabling application discovery on a Nutanix cluster, given that you already have a Prism Central (PC) instance with sufficient CPU and memory are: Internet connection: Application Discovery requires a connection to the Nutanix cloud for gathering and analyzing netflow network data. API key and key ID are necessary for certain functionalities within application discovery and other integrations.
@domain: monitoring
@difficulty: 2
@tags: application-discovery, prism-central, api-key
@briefing: Licensing, CPU, and memory are already satisfied, so stop re-checking them. Application discovery needs two more things before it will turn on: an API key with its key ID, and an internet connection so the service can actually reach out. Both, not either. Miss one and the feature sits there configured and inert, which is the worst state to leave anything in.
@multi: true
@review: Choose-two. Two correct options. Same decision as Q13.

---

### ncp-mci-e1-q48

An administrator needs to clean up inactive VMs using VM Efficiency in Nutanix. How long will have passed before these VMs are deleted?

- ( ) For Dead VMs, the wait before deletion is 120 days.
  > Incorrect: calculation of the wait period.
- ( ) For Zombie VMs, the wait before deletion is 129 days.
  > Incorrect: Zombie VMs Considered inactive after 21 days, then must wait 99 more days before deletion. (120)
- (x) For Dead VMs, the wait before deletion is 129 days.
  > Correct: Dead VMs Considered inactive after 30 days, then must wait 99 more days before deletion.
- (x) For Zombie VMs, the wait before deletion is 120 days.
  > Correct: Zombie VMs Considered inactive after 21 days, then must wait 99 more days before deletion. (120)

@overall: Dead VMs and Zombie VMs are different classifications of inactive VMs in Nutanix, and their deletion timelines depend on Playbook configuration. Dead VMs Considered inactive after 30 days, then must wait 99 more days before deletion. Total time: 30 + 99 = 129 days. Zombie VMs Considered inactive after 21 days, then must wait 99 more days before deletion. Total time: 21 + 99 = 120 days.
@domain: vms
@difficulty: 3
@tags: vm-efficiency, dead-vm, zombie-vm, reclamation
@briefing: Inactive machines are not all inactive in the same way, and Nutanix counts them differently. A Zombie VM is considered inactive after 21 days; a Dead VM after 30. Both then wait a further 99 days before deletion. Do the arithmetic and you get 120 days for a Zombie and 129 for a Dead VM. The two clocks start at different times, which is the entire trick of the question. Know which classification you are staring at before you promise anyone a date.
@multi: true
@review: MALFORMED IN SOURCE. Not labelled 'Choose two' but two options are marked correct. It bundles two independent facts (Dead VMs = 129 days; Zombie VMs = 120 days) into one 4-option item. RECOMMEND: split into two separate single-answer questions.

---

### ncp-mci-e1-q50

Which two actions occur by default on a node which is placed in Maintenance Mode? (Choose two.)

- ( ) Non-migratable VMs are powered off and restarted on other hosts in the cluster.
  > Incorrect: Non-migratable VMs are not automatically restarted on other hosts---they remain powered off until manually restarted.
- (x) All eligible VMs on the host are migrated to other hosts in the cluster.
  > Correct: Nutanix attempts to live migrate all virtual machines (VMs) that are configured to allow live migration.
- ( ) All eligible VMs on the host are powered off.
  > Incorrect: Eligible VMs are live-migrated, not powered off.
- (x) Non-migratable VMs are powered off.
  > Correct: VMs that cannot be live migrated, such as those with CPU passthrough, PCI passthrough, pinned VMs (with host affinity policies), and RF1 VMs, are powered off. .

@overall: When a node is placed into Maintenance Mode, Nutanix follows a structured process to ensure service continuity and data integrity. 1- Live Migration automatically moves VMs to other hosts to avoid downtime. 2- Some VMs, such as those using GPU pass-through or local storage dependencies, cannot be livemigrated.
@domain: lifecycle
@difficulty: 2
@tags: maintenance-mode, live-migration, agent-vm
@briefing: Put a node into maintenance mode and two things happen without you asking. Every VM that can be moved is live migrated off to other hosts in the cluster, so the workloads keep running. Every VM that cannot be moved — your Agent VMs and the other pinned machines — is powered off, because there is no honest alternative. That is the default behaviour. Know which of your VMs are in the second group before you drain a host, not after.
@multi: true
@review: Choose-two. Two correct options. Same decision as Q13.

---

### ncp-mci-e1-q51

An administrator is tasked with optimizing a VM's storage to leverage compression features. Currently, vDisks are in a storage container default-container-91003002003041 that has no optimization activated. The administrator must move the VM's storage to the storage container Production. What is the most efficient way to achieve this operation?

- ( ) Recreate vDisk in the Production storage container configuration and copy data.
  > Incorrect: It requires significant manual effort, creates potential for data inconsistency if the application is live, and often necessitates taking the service offline to ensure a clean copy.
- ( ) Migrate vDisks to the Production storage container.
  > Incorrect: It is a single automated task that maintains the VM's configuration and metadata. The system handles the background data copy and cutover with minimal to no impact on VM availability
- ( ) Recreate VM in the Production storage container configuration and copy data.
  > Incorrect: This is the most time-consuming option. It requires reconfiguring VM settings (CPU, RAM, Network) and typically results in a new UUID/MAC address, which can break software licensing or network configurations.
- (x) Migrate VM to the Production storage container.
  > Correct: While some interfaces might group storage moves under VM updates, the specific operation required here is a vDisk migration to change the underlying storage container while keeping the VM on its current compute resources

@overall: Nutanix applies storage policies—such as compression, deduplication, and Replication Factor (RF)—at the storage container level. If a VM is residing in a container without these features enabled, simply turning them on for that container will only affect new writes; it will not immediately compress existing data unless a background "Curator" scan is triggered. By migrating the vDisks to a container that already has compression enabled (the Production container), Nutanix performs a cross-container move. During this move, the data is rewritten into the new container, allowing the Capacity Optimization Engine (COE) to apply the target container's compression policy to the data as it is moved. This operation can be performed via the Prism Central UI or the acli (Acropolis CLI) using the vm.update_container command, which allows for either all disks or specific disks to be moved without downtime.
@domain: storage
@difficulty: 3
@tags: storage-container, compression, vdisk-migration
@briefing: Compression, deduplication, and replication factor are properties of the storage container, not of the VM. Turning compression on for a container only affects new writes; the data already sitting there stays as it was until something rewrites it. So to get an existing VM's data compressed, move it into the container that already has compression enabled. The migration rewrites the data into the target container, and the optimization engine applies the new container's policy on the way in. No rebuild, no new UUID, no downtime.
@review: SOURCE KEY IS CONTRADICTORY — do not import until resolved. The option marked Correct ('Migrate VM...') carries an explanation that describes a *vDisk* migration; the option marked Incorrect ('Migrate vDisks...') carries a wholly positive rationale; the overall explanation says 'By migrating the vDisks...'; and the exam UI marker points at 'Migrate vDisks'. Three of four signals indicate the intended answer is 'Migrate vDisks to the Production storage container.' and that the Correct/Incorrect prefixes were swapped. NOT flipped automatically. Confirm and I will move it to the live bank.

---

### ncp-mci-e1-q54

An administrator is trying to troubleshoot the environment after NCC raised an alert. 1 Detailed information for remote_site_connectivity_check: 2 Node x.x.x.x: 3 WARN: Failed to connect to the remote site <remote_site>. Which two steps should an administrator follow to provide a solution? (Choose two.)

- (x) Confirm that the remote cluster is reachable, and ports 2009 and 2020 are open between the clusters.
  > Correct: Ensuring connectivity and open ports is crucial for communication.
- ( ) Configure Network Address Translation performed by any device in between the two Nutanix clusters.
  > Incorrect: configuring Network Address Translation (NAT), isn't a direct solution to the stated problem. While NAT might exist in the network, the core issue is basic connectivity on ports 2009 and 2020. Focus on verifying that these ports are open and reachable before addressing complex NAT scenarios.
- (x) If the remote site has been re-configured and the cluster has a new cluster incarnation ID, re-create the remote site.
  > Correct: Re-creating the remote site may be necessary if the cluster ID has changed.
- ( ) Check if ping packets with an MTU of 9000 reach the destination cluster.
  > Incorrect: checking ping packets with an Maximum Transmission Unit (MTU) of 9000, is a less common issue. While MTU fragmentation can cause issues, start with the simpler checks in A and C first. An MTU check is part of NCC but the core issue here is connectivity, not necessarily MTU size. NCC does cover an MTU_check.

@overall: The NCC alert remote_site_connectivity_check WARN message indicates a failure to connect to the remote site. To troubleshoot, you should focus on network connectivity between the sites. The following two steps address this: 1. Confirm that the remote cluster is reachable, and ports 2009 and 2020 are open between the clusters: This directly addresses the error message. As seen in multiple examples, the failure to connect on ports 2009 and 2020 is the primary reason for this alert. 3. If the remote site has been re-configured and the cluster has a new cluster incarnation ID, re-create the remote site: If the remote site's configuration has changed significantly, including a new cluster incarnation ID, the local cluster's connection information might be outdated, triggering the connectivity failure. Re-creating the remote site configuration on the local cluster ensures the correct connection details are in place.
@domain: data-protection
@difficulty: 3
@tags: remote-site, ncc, ports, incarnation-id
@briefing: NCC says it cannot reach the remote site, and that has two honest causes. Either the path is shut — so confirm the remote cluster is actually reachable and that ports 2009 and 2020 are open between the clusters — or the site on the other end is no longer the site you configured. If it has been rebuilt it carries a new cluster incarnation ID, and the old remote-site definition is pointing at a ghost. Re-create it. Check the road first, then check that the destination is still the same place.
@multi: true
@review: Choose-two. Two correct options. Same decision as Q13.

---

### ncp-mci-e1-q57

An administrator has migrated a physical MySQL database from a legacy 3-Tier environment to a Nutanix cluster. Post migration, the administrator finds that at peak load, the number of IOPS being generated is lower than expected, and latency is higher. Which two steps should the administrator take to improve this behavior? (Choose two.)

- (x) Use LVM to stripe the SQL data across multiple vDisks.
  > Correct: Striping data across multiple vDisks can improve IOPS and reduce latency.
- (x) Create additional vDisks for SQL data.
  > Correct: Additional vDisks can help distribute the load and improve performance.
- ( ) Ensure that the SQL data vDisks are thick provisioned.
  > Incorrect: Thick provisioning can improve performance but may not be the best option for all environments.
- ( ) Ensure that the SQL data vDisks are thin provisioned.
  > Incorrect: Thin provisioning can save space but may not improve performance.

@overall: Striping data and creating additional vDisks can improve IOPS and reduce latency.
@domain: performance
@difficulty: 3
@tags: vdisk, lvm, striping, iops, database
@briefing: A single vDisk is a single queue, and a single queue has a ceiling no amount of database tuning will lift. That is why the IOPS are short and the latency is high at peak. Give the workload more paths: create additional vDisks for the SQL data, then use LVM to stripe the data across them. Now the I/O is spread over multiple vDisks in parallel instead of queueing behind one. Nutanix scales with vDisks. One disk, one bottleneck.
@multi: true
@review: Choose-two. Two correct options. Same decision as Q13.

---

### ncp-mci-e1-q60

An administrator has deployed two Nutanix clusters and is now establishing synchronous replication between them. However, the replication is failing immediately. Which two responses show the reason and corrective action an administrator can take to resolve the issue? (Choose two.)

- ( ) If the primary and the recovery clusters are on the same subnet, open the ports manually for communication.
  > Incorrect: When both clusters are on the same subnet, CVM communication typically uses the internal bridge (br0 or eth0), and required ports are already open by default; manual firewall modification is not necessary.
- (x) If the primary and the recovery clusters are in different subnets, open the ports manually for communication.
  > Correct: When clusters are in different subnets, firewall ports must be manually opened for communication between the two clusters (for replication, Stargate, etc.).
- ( ) Use the command modify firewall to open the ports on eth1 interface.
  > Incorrect: The eth1 interface is used for the internal backplane network (192.168.5.x) between CVMs and hypervisors, not for external replication traffic.
- (x) Use the command modify firewall to open the ports on eth0 interface.
  > Correct: Replication traffic between clusters in different subnets travels via eth0 (the external data network). To enable communication, the firewall on eth0 must be modified to open required ports (e.g., 2009, 2020, etc.).

@overall: Synchronous (and asynchronous) replication between clusters in different subnets requires: 1 1- Manually opened for communication between the two clusters (for replication, Stargate, etc.). 2 2- Proper routing and open firewall ports on the external interface (eth0).  The modify_firewall command is used on eth0, because that’s the interface for external CVM-to-CVM communication across clusters.  When clusters are on the same subnet, this configuration is not needed, since local traffic on br0 is already allowed by default.
@domain: data-protection
@difficulty: 3
@tags: synchronous-replication, firewall, ports, eth0
@briefing: Replication between two clusters fails instantly, which means it never established the connection at all. When the clusters sit in different subnets, that traffic leaves the local network and the ports have to be opened by hand — they are not permitted for you. Use the modify firewall command on eth0, because eth0 is the external interface that carries CVM-to-CVM traffic between clusters. On the same subnet none of this is necessary; local traffic is already allowed. Cross a subnet boundary and you must open the road yourself.
@multi: true
@review: Choose-two. Two correct options. Same decision as Q13.
