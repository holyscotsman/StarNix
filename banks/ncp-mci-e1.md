# NCP-MCI question bank — Exam 1 — live bank

> **Cert pack:** NCP-MCI · **Source:** TXT.rtf · **Questions:** 51
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

### ncp-mci-e1-q1

An administrator sees the alert shown in the exhibit. What should the administrator do to make sure the Nutanix user can no longer SSH to a CVM using a password?

@image: ncp-mci-e1-q1.png
@image-alt: Prism alert detail: 'The cluster is using password based ssh access for the cvm 192.168.10.102.' Severity Info, impact type Configuration. Summary states password-based remote login is enabled and recommends key-based SSH instead. Recommendation: change the SSH security setting of the CVM.

- ( ) Rename the nutanix user.
  > Incorrect, renaming does not prevent SSH access.
- ( ) Block port 22 on the CVM firewall.
  > Incorrect, blocks all SSH access but affects all users.
- (x) Enable Cluster Lockdown.
  > Correct: prevents SSH access for the nutanix user using password.
- ( ) Delete the nutanix user.
  > Incorrect: Not recommended; can cause system issues.

@overall: Enabling Cluster Lockdown ensures the nutanix user cannot SSH using a password.
@domain: security
@difficulty: 2
@tags: cluster-lockdown, ssh, cvm, alerts
@briefing: The BCM does not need to breach the hull if we leave a password-shaped door open. That alert says a CVM still accepts password SSH. Renaming the nutanix user changes the label on the door, not the lock. Blocking port 22 seals the whole corridor and locks our own engineers out with it. Deleting the account breaks the systems that depend on it. Enable Cluster Lockdown: it disables password-based SSH and forces key-based access only. Keys we control. Passwords they can guess. Shut it down.

---

### ncp-mci-e1-q2

How many copies of the metadata are maintained within a Redundancy Factor 3 Nutanix cluster?

- ( ) 2
  > Incorrect, even insufficient for RF2 clusters.
- ( ) 3
  > Incorrect, as RF3 requires more metadata copies, but 3 is number of copies for RF2.
- (x) 5
  > Correct: as RF3 maintains five metadata copies.
- ( ) 7
  > Incorrect: not the default metadata copy count for RF3.

@overall: A Redundancy Factor 3 (RF3) cluster maintains five copies of the metadata. This ensures availability and consistency even if two nodes fail. While the data itself has three copies in RF3, the metadata has five to guarantee quorum and prevent split-brain scenarios.
@domain: architecture
@difficulty: 2
@tags: redundancy-factor, rf3, metadata, quorum
@briefing: The station's core index, the metadata, is how we find every fragment we haul back. Redundancy Factor 3 keeps three copies of the data, and crews assume the index matches. It does not. RF3 maintains five copies of the metadata. Five, so quorum survives two nodes going dark without a split-brain tearing the map in half. Three is the RF2 figure. Carry it into an RF3 build and you are a fragment short exactly when it matters. Say it back: data three, metadata five.

---

### ncp-mci-e1-q3

Which update in LCM can an administrator apply on a per-node basis?

- ( ) AOS
  > Incorrect: AOS upgrades affect the entire cluster and require cluster-wide consistency.
- (x) BMC
  > Correct: BMC firmware controls remote management and power cycling of individual nodes. Updating BMC does not impact the entire cluster and can be done per node.
- ( ) NCC
  > Incorrect: NCC updates apply across all nodes simultaneously, ensuring uniformity in checks.
- ( ) AHV
  > Incorrect: AHV updates require coordinated upgrades across hosts to maintain VM availability.

@overall: Nutanix LCM allows firmware updates to be applied on a per-node basis. While software updates generally apply to the whole cluster, firmware updates like BIOS or BMC can be applied to individual nodes.
@domain: lifecycle
@difficulty: 2
@tags: lcm, firmware, bmc, upgrades
@briefing: Not every upgrade lands the same way. Software — AOS, NCC, AHV — rolls out cluster-wide, because every node has to agree or the formation fractures. Firmware is different. BMC governs remote management and power for one node and one node only, so LCM can push it per node without touching the rest of the cluster. When the question is which update applies to a single node, the answer is firmware. Software, cluster-wide. Firmware, per node.

---

### ncp-mci-e1-q4

What is the default admin session log out time?

- ( ) 5 minutes
  > Incorrect, Too short for default setting
- ( ) 10 minutes
  > Incorrect, default setting is 15 min
- (x) 15 minutes
  > Correct: default session timeout
- ( ) 20 minutes
  > Incorrect: Not the default setting

@overall: The default admin session timeout in Prism is 15 minutes. While the session timeout setting in the UI can be adjusted to longer durations, the IAM token and session cookie still expire after 15 minutes. The UI setting controls how long the UI attempts to keep the session alive by making API calls.
@domain: security
@difficulty: 1
@tags: prism, session-timeout, iam
@briefing: An idle console is an open console. Prism logs an admin session out after fifteen minutes by default. You can stretch what the interface shows you, but the IAM token and the session cookie still expire at fifteen; the UI is just making calls to look alive. Ten is not the default. Five would be paranoid, twenty wishful. Fifteen. Step away longer than that and you come back to a login prompt, which is exactly what we want if the BCM is watching.

---

### ncp-mci-e1-q5

When configuring a physical network switch in Prism Element, what information is needed?

- ( ) DNS Configuration
  > Incorrect, Not required when adding a switch.
- ( ) NTP Configuration
  > Incorrect, Useful but not mandatory.
- ( ) SMTP Configuration
  > Incorrect, Not relevant for switch configuration.
- (x) SNMP Configuration
  > Correct, Required for monitoring switch status and metrics.

@overall: To configure a physical network switch in Prism Element, you'll need SNMP information for the switch, including the switch management IP address, SNMP version, security level, community name, authentication type, privacy type (if applicable), and privacy passphrase (if applicable).
@domain: networking
@difficulty: 2
@tags: prism-element, snmp, switch
@briefing: You want Prism Element to see the physical switch, not just the cable running into it. That takes SNMP; it is how the cluster polls the switch for status and metrics. DNS resolves names, NTP keeps clocks honest, SMTP mails alerts — all useful, none of them the thing a switch reports in on. Adding a physical switch in Prism Element means supplying SNMP configuration. Without it the switch is a black box and we are flying the network blind.

---

### ncp-mci-e1-q6

After deploying a cluster, time is not synchronizing properly. What task needs to be performed on the cluster?

- ( ) DNS configuration
  > Incorrect: DNS is unrelated to time synchronization.
- (x) NTP configuration
  > Correct: NTP is required to synchronize time across the cluster.
- ( ) HA configuration
  > Incorrect: HA does not affect time settings.
- ( ) SMTP configuration
  > Incorrect: SMTP is for email notifications, not time settings.

@overall: NTP (Network Time Protocol) configuration is necessary. After the cluster deployment, ensure that the NTP service is running and configured correctly on each CVM. The cluster should be configured to synchronize with at least three reliable NTP servers for redundancy and accuracy.
@domain: networking
@difficulty: 1
@tags: ntp, time-sync, cluster-config
@briefing: Clocks drifting apart is how a cluster starts lying to itself: logs out of order, certificates rejected, services unable to agree on when now is. If time will not synchronize after deployment, nothing exotic has broken. You skipped NTP. Point the cluster at reliable time sources and configure it. Every node marches to the same clock, or none of them do.

---

### ncp-mci-e1-q7

In an RF2 Nutanix cluster, what is the minimum number of nodes required to allow a host removal?

- ( ) 2
  > Incorrect, RF2 requires at least 3 nodes for redundancy.
- ( ) 3
  > Incorrect, Removing a node from a 3-node cluster would break RF2.
- (x) 4
  > Correct: A 4-node cluster can sustain a single-node removal while maintaining RF2.
- ( ) 5
  > Incorrect: RF2 does not require 5 nodes.

@overall: Four nodes are required to remove a host from an RF2 Nutanix cluster. With RF2, two copies of the data exist, ensuring redundancy and fault tolerance. A four-node cluster ensures sufficient resources are available for data replication and availability during the host removal process.
@domain: architecture
@difficulty: 2
@tags: rf2, node-removal, resiliency
@briefing: Removing a host is not just powering it down. The cluster has to keep two copies of everything while it rebuilds what the departing node was holding. In an RF2 cluster that means four nodes minimum before a host removal is allowed — three still standing after the fourth walks out, which is the floor RF2 needs to stay resilient. Try it with three and the data has nowhere to rebuild to. Count the hulls before you pull one out of formation.

---

### ncp-mci-e1-q8

An administrator has been tasked with increasing security on a Nutanix cluster by disabling password authentication when accessing the CVM and AHV hosts and instead moving to key-based SSH. What is the easiest way for the administrator to meet these requirements?

- ( ) Configure LDAP authentication through a secure server.
  > Incorrect, LDAP does not affect SSH key authentication.
- ( ) Enable STIG via command line on SSH to CVM.
  > Incorrect, STIG security compliance does not enforce SSH keys.
- (x) Enable Cluster Lockdown and provide an RSA key.
  > Correct: Cluster Lockdown disables password access and enforces SSH key authentication.
- ( ) Restrict access with User Management in Prism.
  > Incorrect: Prism user management does not enforce SSH key authentication.

@overall: To increase security on a Nutanix cluster by disabling password authentication for Controller Virtual Machine (CVM) and AHV hosts and moving to key-based SSH, enabling Cluster Lockdown and providing an RSA key is the recommended approach.1
@domain: security
@difficulty: 2
@tags: cluster-lockdown, ssh, rsa-key, ahv
@briefing: Same lock, bigger door. The order is to kill password authentication across the CVMs and the AHV hosts and move to key-based SSH. The easiest path is not a script and not a firewall rule. It is Cluster Lockdown, and you hand it an RSA public key on the way in. Lockdown disables password authentication cluster-wide; the key you provided becomes the only way through. Provide the key first. Enable lockdown without one and you have locked yourself out alongside the BCM.

---

### ncp-mci-e1-q9

An administrator needs to make sure that a VM is powered on before the rest of the VMs when starting a host. Which configuration option allows this behavior?

- ( ) Recovery Plan
  > Incorrect, Recovery Plans are used for DR but do not control boot order during host startup.
- ( ) Host Affinity
  > Incorrect, Host Affinity controls VM placement but not boot priority.
- ( ) High Availability
  > Incorrect, High Availability ensures VMs restart after a failure but does not define boot order.
- (x) Agent VM
  > Correct, Agent VMs, such as those for security or management, can be prioritized to start before others.

@overall: The configuration option that allows a VM to be powered on before other VMs when starting a host is to configure the VM as an agent VM. This setting ensures that the VM is prioritized during the host's startup sequence and is powered on before other standard VMs. Agent VMs are typically used for essential services, such as providing network functions, that need to be available before other VMs can function correctly.
@domain: vms
@difficulty: 2
@tags: agent-vm, boot-order, ahv
@briefing: Some systems have to be breathing before anything else wakes up — the services the rest of the fleet leans on. Flag that machine as an Agent VM. Agent VMs power on ahead of other VMs when a host starts, and they are not live-migrated during maintenance; they come up first and they stay put. That is the setting you want when a VM must lead the boot order rather than follow it.

---

### ncp-mci-e1-q10

When expanding a Nutanix cluster, what is required to automatically discover new nodes?

- ( ) New nodes must have the same hypervisor version.
  > IIncorrect: While important, it is not required for automatic discovery.
- (x) IPv6 multicast must be allowed on physical switches.
  > Correct: Nutanix does require IPv6 multicast for node discovery.
- ( ) New nodes must have the same AOS version.
  > Incorrect: Required for compatibility but not for discovery.
- ( ) IPv4 multicast must be allowed on physical switches.
  > Incorrect: Nutanix does not uses IPv4 multicast for node discovery.

@overall: IPv6 multicast must be allowed on the physical switches for automatic node discovery during cluster expansion. The Controller Virtual Machine (CVM) initiates the process by sending IPv6 and IPv4 multicast packets on port 5353.
@domain: networking
@difficulty: 2
@tags: cluster-expansion, ipv6, multicast, discovery
@briefing: A new node announces itself before it has any address we gave it. That handshake rides on IPv6 multicast, which is why automatic discovery dies the moment a physical switch blocks it. If you are expanding the cluster and the new nodes never appear, stop interrogating the node and look at the switch. IPv6 multicast must be permitted on the physical switches. Block it and you are adding every node by hand, one at a time, in the dark.

---

### ncp-mci-e1-q11

An administrator has been asked to calculate baseline Capacity Runway on a newly registered AHV cluster. The cluster has been up and running for 16 days, but no runway projections are displayed. Why are no Capacity Runway projections being displayed?

- ( ) Capacity Planning requires at least 30 days of data.
  > Incorrect: 30 days is not the minimum requirement.
- (x) Capacity Planning requires at least 21 days of data.
  > Correct: at least 21 days of historical data is required for projections.
- ( ) Capacity Planning requires at least 3 months of data.
  > Incorrect: projections can be generated before 3 months.
- ( ) Capacity Planning requires at least 6 months of data.
  > Incorrect: projections can be generated well before 6 months.

@overall: Capacity Runway projections require at least 21 days of data from a newly registered AHV cluster. Since the cluster has only been running for 16 days, there is insufficient data for the projections to be displayed. Additionally, it takes approximately one day after cluster registration for data to begin appearing in Prism Central
@domain: monitoring
@difficulty: 2
@tags: capacity-runway, capacity-planning, prism-central
@briefing: Sixteen days of telemetry and no runway projection. That is not a fault — that is the system refusing to guess. Capacity Planning needs at least twenty-one days of data before it will project a runway. Less than that and the trend line is noise wearing the costume of a forecast, which is more dangerous than no forecast at all. Give it five more days. We do not plan the station's future on a curve the machine itself will not vouch for.

---

### ncp-mci-e1-q12

An administrator is responsible for resource planning and needs to plan for resiliency of a 10-node RF3 Nutanix cluster. The cluster has 100TB of storage. How should the administrator plan for capacity in the event of future failures?

- ( ) Set Reserve Storage Capacity (%) to 20.
  > Incorrect; does not account for RF3 failure requirements.
- ( ) Set Reserve Capacity for Failure to None.
  > Incorrect; this would leave no reserved space for failures.
- (x) Set Reserve Capacity for Failure to Auto Detect.
  > Correct: auto-detect ensures the cluster accounts for failures dynamically.
- ( ) Set Reserve Memory Capacity (%) to 20.
  > Incorrect: Memory capacity does not impact storage resiliency.

@overall: In an RF3 cluster, using "Auto Detect" ensures that failure reserves are calculated correctly.
@domain: monitoring
@difficulty: 2
@tags: reserve-capacity, capacity-planning, rf3
@briefing: Planning capacity as though nothing will ever fail is how a cluster runs out of room during the failure. Set Reserve Capacity for Failure to Auto Detect. The system then holds back enough CPU, memory, and storage to absorb a node loss and rebuild, sized from the cluster's own configuration instead of a number you guessed at. Ten nodes, RF3, a hundred terabytes: let it do the arithmetic. Reserve first, then plan growth against what is actually left.

---

### ncp-mci-e1-q14

An administrator is working with a network team to design the network architecture for a Disaster Recovery (DR) failover. Because DNS is well-designed and implemented, DR will utilize a different subnet from production. To make the planning and execution easy to implement, the network team would like to utilize the same last octet in the IP address in DR. What is the best way to achieve this?

- ( ) Use a custom script to update the IP address after instantiation in DR.
  > Incorrect; Works, but is not the best automated solution.
- ( ) Set up IPAM so the address is dynamically assigned during DR.
  > Incorrect; Works, but requires an external system to manage addresses.
- ( ) Manually log into VMs after the DR event and update the last octet.
  > Incorrect; Inefficient and not recommended for automation.
- (x) Utilize Recovery Plan Offset-based IP mapping.
  > Correct; allows automatic IP address adjustment during failover.

@overall: The best way to retain the same last octet in the IP address while using a different subnet during DR failover is to use static IP mapping within the Recovery Plan. While Nutanix often tries to retain the last octet automatically, it's not guaranteed without static mapping.
@domain: data-protection
@difficulty: 3
@tags: recovery-plan, ip-mapping, dr, subnet
@briefing: Fail over into a different subnet and every machine wakes up with the wrong address. You can hand-map all of them and lose the night, or you can let the Recovery Plan do it. Offset-based IP mapping carries the host portion of each address into the recovery subnet automatically: same host number, new network. DNS is well built on our side, so names keep resolving to the right place. One rule, every VM, no spreadsheet.

---

### ncp-mci-e1-q15

A user created a report in the prism central Intelligent Operations Analysis Dashboard but forgot to download it. However, after logging back into Prism Central, the administrator finds that the report is no longer available. What is the most likely cause?

- ( ) A user with Cluster Viewer role deleted the report.
  > Incorrect; cluster Viewer cannot delete reports.
- ( ) The user-generated report was archived.
  > Incorrect; reports are not archived automatically.
- (x) Reports are automatically deleted after 24 hours.
  > Correct: temporary reports are deleted after 24 hours.
- ( ) The report is stored in the cluster’s Prism Element.
  > Incorrect: reports are stored in Prism Central, not Prism Element.

@overall: The most likely reason is that the report was automatically deleted after 24 hours. Reports generated in the Intelligent Operations dashboard are automatically purged after this time. To retain a report, you should download it (in PDF or CSV format) or save it as a report configuration for later use.
@domain: monitoring
@difficulty: 2
@tags: reports, prism-central, intelligent-operations
@briefing: Generate a report and it is not yours until you download it. Prism Central holds a generated report for twenty-four hours and then it is gone. Not archived. Not recoverable. Gone. If you built it and walked away, you build it again. Pull the file down while you are still looking at it.

---

### ncp-mci-e1-q16

An administrator receives complaints about VM performance. After reviewing the VM’s CPU Ready Time data shown in the exhibit, which step should the administrator take to diagnose the issue and identify root cause?

@image: ncp-mci-e1-q16.png
@image-alt: A VM CPU Ready Time chart in Prism Central showing many overlapping per-VM series (curie_test vmsmall / vmmedium / vmlarge) over a ten-minute window, with a hover tooltip listing individual VMs and readings of 18%, 18.8% and 21.5%.

- ( ) Check the number of vCPUs assigned to each CVM.
  > Incorrect: CVMs (Controller VMs) have fixed CPU allocation, and modifying their vCPU count is not recommended unless advised by Nutanix Support.
- (x) Review host CPU utilization.
  > Correct: high CPU Ready Time indicates host CPU contention.
- ( ) Assess cluster SSD capacity.
  > Incorrect: SSD capacity impacts storage performance (latency, read/write speeds) but does not affect CPU Ready Time.
- ( ) Enable VM memory oversubscription.
  > Incorrect: Memory oversubscription does not affect CPU contention.

@overall: High CPU Ready Time suggests CPU overcommitment or host saturation. The administrator should check host CPU usage in Prism Central to determine if the cluster is overloaded. If host CPU usage is consistently above 85–90%, VMs are competing for CPU resources, leading to high CPU Ready Time.
@domain: performance
@difficulty: 2
@tags: cpu-ready-time, contention, troubleshooting
@briefing: High CPU Ready Time does not mean the VM is working hard. It means the VM is waiting — instructions queued, no physical CPU free to run them. That is contention on the host, not a fault inside the guest. So go look at host CPU utilization. If the hosts are pinned above eighty-five or ninety percent, the VMs are fighting each other for cycles. Do not touch CVM vCPUs, do not blame the SSDs, and do not reach for memory oversubscription. None of them is what is making this VM wait.

---

### ncp-mci-e1-q18

After upgrading Prism Central from PC2022.1 to PC2024.1, an administrator is unable to log in with their IAM active directory domain account. What is the first thing the administrator should do?

- ( ) Ping the Domain Controller from the CVM.
  > Incorrect, Checking network connectivity is useful but not the first step.
- ( ) Ensure port 9441 is open in the firewall.
  > Incorrect, Port 9441 is required for authentication, but other issues may exist.
- ( ) Validate the trusted signing certificate of the organization.
  > Incorrect, Certificate issues can prevent authentication but are not the first check.
- (x) Log in with a local admin account.
  > Correct: Logging in locally allows troubleshooting IAM issues.

@overall: Using a local admin account helps diagnose and fix IAM authentication failures.
@domain: security
@difficulty: 2
@tags: prism-central, iam, active-directory, upgrade
@briefing: The upgrade landed and your domain account will not authenticate. Do not start rebuilding the directory integration — you cannot even see it from out here. Get inside first. Log in with a local admin account, which does not depend on IAM or the AD connection, and diagnose from there. Recover access, then troubleshoot. Standing outside a locked door theorising about the lock helps nobody.

---

### ncp-mci-e1-q19

Refer to the exhibit. The customer expects to maintain a cluster runway of 9 months. The customer doesn’t have a budget for 6 months, but they want to add new workloads to the existing cluster. Based on the exhibit, what is required to meet the customer's budgetary timeframe?

@image: ncp-mci-e1-q19.png
@image-alt: Prism Central capacity runway 'New Scenario' view. Overall Runway 59 days, with CPU, Memory and Storage each also 59 days. Target is set to 6 months. An Existing cluster is selected and Capacity configuration is enabled.

- ( ) Add resources to the cluster.
  > This is incorrect because the customer explicitly has no budget for the next 6 months to purchase additional hardware.
- (x) Postpone the start of new workloads.
  > Correct: By delaying the addition of new workloads until the 6-month mark (when budget becomes available), the customer can keep the current cluster running within its existing limits and then expand the cluster when they have the funds to do so.
- ( ) Delete workloads running on the cluster
  > Incorrect; While this would increase runway, it is usually a last-resort disruptive action and isn't specified as a preference here.
- ( ) Change the target to 9 months.
  > Incorrect; This is a configuration setting in the tool to see what is needed, but it does not actually solve the capacity shortfall to meet the budget.

@overall: The exhibit shows an Overall Runway of 59 days, which is significantly less than the customer's goal of 9 months. Since the customer has no budget for 6 months, they cannot purchase the additional hardware required to expand the cluster's capacity ("Add resources"). By postponing new workloads, the customer avoids overwhelming the existing resources until they reach the 6-month mark, at which point they can secure a budget to scale the cluster and accommodate the new growth while maintaining their 9-month runway target.
@domain: monitoring
@difficulty: 3
@tags: capacity-runway, capacity-planning, prism-central
@briefing: Read the gauge before you commit. Runway is fifty-nine days across CPU, memory, and storage — nowhere near the nine months command wants. There is no resupply for six months, so bolting on hardware is not an option we have. Deleting live workloads is a scorched-hull last resort. Re-setting the target to nine months changes the readout, not the tank. That leaves the disciplined call: hold the new workloads until the budget lands at month six, then expand. Patience keeps us flying. Loading more weight onto fifty-nine days of fuel strands us in the dark.

---

### ncp-mci-e1-q20

A DR administrator has set up a Protection Policy for 50 workloads, all configured similarly in terms of OS, storage, network, and performance. The RPO is 60 minutes with a specified retention of 10 local copies, 5 remote copies, and crash consistency. After configuring the protection policy and activating it, the administrator has noticed that recovery points are not appearing at the DR site yet, everything within the Protection Policy looks correct and recovery points are not showing up on production side. What is the most likely issue?

- ( ) Nutanix Guest Tools (NGT) is not installed on the source VMs.
  > Incorrect, NGT is needed for application-consistent snapshots but not for replication.
- ( ) Windows updates need to be applied to all affected VMs.
  > Incorrect, OS updates do not impact Nutanix replication.
- (x) The storage container name on the DR cluster does not match the production cluster.
  > Correct: If container names do not match, replication will fail.
- ( ) The storage container RF factor does not match in both clusters.
  > Incorrect: RF mismatch affects redundancy, not replication.

@overall: The most likely reason why recovery points are visible on the production side but not at the DR site, despite a correctly configured Protection Policy, is that the storage container name on the DR cluster does not match the production cluster. If a storage container with the same name is not found on the destination cluster, the replicated data will be directed to the SelfServiceContainer. This can lead to recovery points not being readily available in the expected location on the DR site.
@domain: data-protection
@difficulty: 3
@tags: protection-policy, storage-container, dr, rpo
@briefing: Fifty identical workloads, one policy, and only some of them recover. When the failure is selective but the configuration looks uniform, stop staring at the policy and look underneath it. Nutanix DR needs the storage container name on the recovery cluster to match the source. Where the name does not match, the workload has nowhere to land. Same name, both sides. It is the kind of detail that stays invisible right up until the day you actually need the failover.

---

### ncp-mci-e1-q21

An administrator needs to create 2 virtual machines: VM4 and VM5 that leverage the memory over-commit feature. Once VM4 is created and running, the administrator notices that it uses only 28GB of RAM. What will be the maximum RAM that can be allocated to VM5 so that it can be powered on?

@image: ncp-mci-e1-q21.png
@image-alt: Memory table for Host 1 (128 GB). VM1: 64 GB allocated, 48 GB utilized, 16 GB unutilized. VM2: 32 / 20 / 12. VM3: 32 / 24 / 8. Total: 128 GB allocated, 92 GB utilized, 36 GB unutilized.

- ( ) 4GB
  > Incorrect: remaining 8 GB.
- (x) 8GB
  > Correct: Unutilized memory 36 - 28 = 8 GB
- ( ) 16GB
  > Incorrect: no available unutilized memory.
- ( ) 32GB
  > Incorrect: no available unutilized memory.

@overall: Thehost has 128GB of physical RAM. Thecurrent memory allocationacrossthree VMs (VM1, VM2, VM3) is 128GB, but only92GB is actually utilized. This means there is36GB of unutilized memory available for allocation. VM5 can be allocated up to 8GB of RAM, considering overcommit and available resources the available ememory 36 - 28=8.
@domain: vms
@difficulty: 3
@tags: memory-overcommit, ahv, capacity
@briefing: Over-commit lets us promise more memory than we physically hold, and it works because VMs rarely touch everything they are given. So read the table, not the promises. The host has 128 GB. The three running VMs are allocated all 128, but only 92 is actually in use — 36 GB of headroom is genuinely free. VM4 is holding 28 of it. That leaves eight. Eight gigabytes is the ceiling for VM5. Over-commit is generous, not infinite; promise past what the host can truly deliver and something gets swapped, throttled, or killed.

---

### ncp-mci-e1-q22

The team leads of a dev environment want to limit developer access to a specific set of VMs. What is the most efficient way to enable the team leads to directly manage these VMs?

- ( ) Create a role mapping for each team lead and assign appropriately.
  > Incorrect, Role mappings control access but do not limit it to a specific set of VMs efficiently.
- ( ) Create a VPC for each team lead and give them VPC Admin.
  > Incorrect, VPCs are used for network segmentation, not access control for VMs.
- (x) Create a Project for each team lead and assign access.
  > Correct: Projects allow fine-grained control over a specific set of VMs for designated users.
- ( ) Create Security Policies to isolate users.
  > Incorrect: Security policies define network access but do not manage VM access.

@overall: Based on the search results, using projects and roles within Nutanix's access control system seems like the most direct approach for enabling team leads to manage specific VMs in a development environment.
@domain: security
@difficulty: 2
@tags: projects, rbac, prism-central, delegation
@briefing: The team leads want to run their own machines without you standing over them, and you want them nowhere near anyone else's. That is delegation, not permission-by-permission drudgery. Create a Project per team lead and assign access there. The Project scopes exactly which VMs and resources they can touch, and they manage inside it directly. It is the efficient answer because it hands over a bounded sector, not a key to the whole station.

---

### ncp-mci-e1-q23

An administrator using a dark site deployment for LCM is attempting to upgrade to the latest BIOS. After completing an inventory scan, the administrator does not see the expected BIOS version available for upgrade. What is the most likely reason the latest BIOS is not shown after inventory?

- ( ) AOS needs to be upgraded first.
  > Incorrect: AOS does not need to be upgraded first for a BIOS update.
- (x) The latest compatibility bundle has not been uploaded.
  > Correct: LCM relies on an offline compatibility bundle to detect and upgrade firmware.
- ( ) The BMC version needs to be upgraded first.
  > Incorrect: The BMC firmware does not always need updating before BIOS updates.
- ( ) The dark site webserver is not accessible.
  > Incorrect: In a dark site deployment, LCM does not rely on an internet connection, so webserver access is not required.

@overall: The most likely reason the latest BIOS version isn't shown in Life Cycle Manager (LCM) after an inventory scan in a dark site deployment is that the latest compatibility bundle has not been uploaded. LCM relies on the compatibility bundle to understand which updates are available. If the bundle isn't up-to-date, the latest BIOS versions won't be displayed for upgrade.
@domain: lifecycle
@difficulty: 2
@tags: lcm, dark-site, bios, firmware
@briefing: A dark site has no line home. LCM cannot phone Nutanix for what is available, so it only knows about what you have physically carried in. The inventory scan ran and the BIOS version is missing, which means the parts crate is short: the latest compatibility bundle has not been uploaded. Upload it, re-run inventory, and the upgrade appears. In the dark, nothing arrives that you did not bring yourself.

---

### ncp-mci-e1-q24

An administrator needs to create a single chart showing multiple storage bandwidth metrics a VM is consuming. Which type of chart should the administrator create?

- ( ) Metric Chart
  > Incorrect: Metric Charts create a chart that tracks a single metric for one or more entities
- (x) Entity Chart
  > Correct: Entity Charts create a chart that tracks one or more metrics for a single entity
- ( ) Hypervisor Performance Chart
  > Incorrect, These focus on hypervisor-level performance, not VM storage bandwidth.
- ( ) VM Summary Chart
  > Incorrect, These summarize VM details but do not focus on specific metrics.

@overall: To create a single chart that shows multiple storage bandwidth metrics for a single virtual machine (VM), an administrator should create an Entity Chart. An Entity Chart is the appropriate choice because it is designed to display various performance metrics for a single selected entity, such as a specific VM. This allows an administrator to correlate different metrics, like read bandwidth, write bandwidth, and total bandwidth, for that one VM on a single graph. Resources
@domain: monitoring
@difficulty: 2
@tags: charts, entity-chart, prism-central
@briefing: You want several storage bandwidth metrics for one VM, all on one chart, so the lines can be read against each other. That is an Entity Chart: one entity, multiple metrics, stacked on a single set of axes. Metric charts go the other way — one metric across many entities. Pick the wrong one and you get the right data drawn in a shape that answers a question nobody asked.

---

### ncp-mci-e1-q25

What guest customization options are available when creating a VM template?

- (x) Sysprep, Cloud-init
  > Correct: These are standard guest customization options in Nutanix.
- ( ) Bash, Powershell
  > Incorrect: These are scripting languages but not specifically guest customization options.
- ( ) Python, YAML
  > Incorrect, These are used in automation but are not Nutanix guest customization options.
- ( ) Custom Script, Guided Script
  > Incorrect, Guest customization using Sysprep for windows, and Cloud-init for linux

@overall: Sysprep (for Windows), cloud-init (for Linux), custom scripts, and guided scripts are all guest customization options available when creating a VM template.
@domain: vms
@difficulty: 1
@tags: vm-template, sysprep, cloud-init, guest-customization
@briefing: A template is a mould, and a mould that stamps out identical machines — same hostname, same identity — causes chaos the moment two of them meet on the network. Guest customization is how each casting comes out unique. On Windows that is Sysprep. On Linux it is Cloud-init. Those are your two options when you build a VM template, and between them they cover the fleet.

---

### ncp-mci-e1-q26

An administrator wants to make sure that VMs can be migrated and restarted on another node in the event of a single-host failure. What action should be taken in Prism Element to meet this requirement?

- ( ) Set Redundancy Factor to 3.
  > Incorrect, RF3 increases data redundancy but does not ensure VM failover.
- ( ) Configure an RF1 storage container.
  > Incorrect, RF1 has no redundancy, making it unsuitable.
- ( ) Configure a Protection Domain.
  > Incorrect, Protection Domains provide backup and recovery but do not ensure VM failover.
- (x) Enable HA Reservation.
  > Correct, HA Reservation ensures VMs can restart on another node in case of a failure.

@overall: To ensure that VMs can be migrated and restarted on another node in the event of a single-host failure, enable High Availability (HA) in Prism Element. HA reserves a portion of cluster resources to restart VMs on surviving nodes if a host fails.
@domain: vms
@difficulty: 2
@tags: high-availability, ha-reservation, prism-element
@briefing: A host dies. Where do its VMs go? Nowhere, unless somebody set aside room for them in advance. Enable HA Reservation in Prism Element and the cluster holds back enough resources on the surviving nodes to restart the casualties. Redundancy Factor protects the data, not the running machines. A Protection Domain is for recovering elsewhere later. Neither one restarts a VM tonight. HA Reservation does.

---

### ncp-mci-e1-q28

An administrator wants to enable Windows Defender Credential Guard to comply with company policy. The new VM configurations include: • Legacy BIOS • 4 vCPUs • 8 GB RAM • Windows Server 2019 What must be changed in order to properly enable Windows Defender Credential Guard?

- ( ) Update Memory to 16GB.
  > Incorrect, More memory does not enable Credential Guard.
- ( ) Use Windows Server 2022.
  > Incorrect, Credential Guard is supported on Windows Server 2019 as well.
- (x) Enable UEFI with Secure Boot.
  > Correct: Credential Guard requires UEFI with Secure Boot.
- ( ) Update vCPU to 8.
  > Incorrect: More vCPUs do not affect Credential Guard.

@overall: Windows Defender Credential Guard requires UEFI with Secure Boot enabled.
@domain: security
@difficulty: 2
@tags: credential-guard, uefi, secure-boot, windows
@briefing: Credential Guard protects secrets inside a hardware-backed vault, and a vault needs a foundation it can trust from the first instruction. Legacy BIOS cannot give it one. Enable UEFI with Secure Boot: Secure Boot establishes the verified boot chain that Credential Guard's virtualization-based security depends on. The vCPUs and the RAM in that spec are fine. The firmware mode is the thing standing in your way.

---

### ncp-mci-e1-q29

An administrator attempted to enable Data-in-Transit Encryption on a Scale-Out Prism Central cluster to encrypt service-level traffic between nodes. However, the feature did not work correctly due to a firewall restriction. Which CVM-specific port should be allowed through the firewall for Data-in-Transit Encryption?

- (x) 2009
  > Correct: port to allow for Data-in-Transit Encryption on a Scale-Out Prism Central cluster is 2009
- ( ) 9440
  > Incorrect: Used for Prism Central UI access.
- ( ) 2010
  > Incorrect, Not related to Data-in-Transit Encryption.
- ( ) 2020
  > Incorrect, Port 2009, not 2020, is used for data-in-transit encryption within a Nutanix cluster.

@overall: The correct port to allow for Data-in-Transit Encryption on a Scale-Out Prism Central cluster is 2009. The Nutanix Security Guide v7.0 states that you should "ensure that you allow port 2009, which is used for Data-in-Transit Encryption." This document also notes that Data-in-Transit Encryption encrypts service-level traffic between cluster nodes.
@domain: security
@difficulty: 3
@tags: data-in-transit-encryption, ports, firewall, prism-central
@briefing: Data-in-Transit Encryption protects the service-level traffic running between cluster nodes — exactly the traffic the BCM would most like to sit and listen to. It cannot establish that if a firewall is standing in the path. The CVM port to open is 2009. Not 9440, that is the Prism interface. Open 2009 and the encrypted channel forms; leave it shut and the feature configures cleanly and then does nothing at all.

---

### ncp-mci-e1-q30

In a scale-out Prism Central deployment, what additional functionality does configuring an FQDN instead of a Virtual IP provide?

@image: ncp-mci-e1-q30.png
@image-alt: Prism Central 'Cluster Details' dialog. Text reads: Virtual IP and FQDN are used to access the PC VM Cluster. Fields for Cluster Name (Unnamed), FQDN, and Virtual IP, with a note that Virtual IP is relevant for a multi-VM Prism Central.

- (x) Load balancing
  > Correct: because it ensures that requests are distributed among multiple Prism Central nodes, improving performance and redundancy.
- ( ) Resiliency
  > Incorrect: because resiliency is achieved through HA and replication, not through FQDN configuration.
- ( ) Segmentation
  > Incorrect, because network segmentation is handled at the VLAN or security policy level.
- ( ) SSL Certificate
  > Incorrect, because SSL certificates can be applied regardless of whether FQDN or Virtual IP is used.

@overall: When using FQDN instead of a Virtual IP in a scale-out Prism Central deployment, Nutanix enables load balancing across multiple Prism Central instances.
@domain: architecture
@difficulty: 2
@tags: prism-central, fqdn, scale-out, load-balancing
@briefing: A Virtual IP gives a scale-out Prism Central one address to answer on — a single door into a building with several rooms. An FQDN does more than name the door. Configure the FQDN instead and Nutanix load balances requests across the Prism Central instances, spreading the work instead of funnelling it. Not segmentation, not certificates. Load balancing. That is the functionality you gain.

---

### ncp-mci-e1-q31

How can a VM or Volume Group (VG) be associated with a Storage Policy?

- ( ) Assign the Storage Policy directly on the VM or VG.
  > Incorrect, as policies apply to categories.
- ( ) Assign the VM or VG directly to the Storage Policy.
  > Incorrect, Storage Policies apply to categories, not directly to VMs/VGs.
- ( ) Migrate the VM or VG to the Storage Container assigned to the Storage Policy.
  > Incorrect, Not a valid method to apply a storage policy.
- (x) Assign the VM or VG to the same Category as the Storage Policy.
  > Correct, Storage policies are applied at the category level.

@overall: A VM or Volume Group (VG) can be associated with a Storage Policy using categories. Storage Policies are applied to VMs and VGs via categories using the Kanon service, which applies/fixes up policies every 30 minutes. A default Storage Policy can be selected during VM/VG creation
@domain: storage
@difficulty: 2
@tags: storage-policy, categories, volume-group
@briefing: You do not bolt a Storage Policy onto a machine by hand — that does not scale past the first dozen. You describe the machine, and the policy finds it. Assign the VM or Volume Group to the same Category the Storage Policy targets, and the association happens by itself. Categories are the labels; policies act on the labels. Label the cargo correctly and the rules apply themselves.

---

### ncp-mci-e1-q32

An administrator is managing a 4-node Nutanix cluster, based on intermixed hardware as follows: • Two G5 Nodes # 2 CPUs (12 cores), 1 SSD (1.92 TB), 2 HDDs (4 TB). • Two G7 Nodes # 2 CPUs (16 cores), 2 SSDs (1.92 TB), 4 HDDs (4 TB). G5 Nodes are going out of support and need to be replaced, this cluster will be decommissioned from production and used for Disaster Recovery purposes with an RPO of 1 hour. What is the supported configuration when swapping G5 nodes without impacting performance?

- (x) New node must have at least 2 SSDs.
  > Correct: Since the G7 nodes have two SSDs, replacing G5 nodes with at least 2 SSDs ensures consistent SSD cache and performance.
- ( ) New node must be G7 or G8.
  > Incorrect: G7 or G8 nodes may help, but storage performance is more critical for DR.
- ( ) New node must have 2 CPUs with 12 cores.
  > Incorrect, CPU core count does not impact DR storage performance as much as SSD capacity.
- ( ) New node must be hybrid.
  > Incorrect, Hybrid nodes are already in use, but SSDs must match for performance balance.

@overall: For optimal Disaster Recovery performance, new nodes must match or exceed the storage performance of existing nodes View sources
@domain: architecture
@difficulty: 3
@tags: intermixed-hardware, cluster-expansion, ssd
@briefing: Mixed hardware in one cluster is allowed, but the newcomer cannot drag the formation backwards. Two G5s with a single SSD each, two G7s with two — the cluster's storage tier is built on what the nodes bring. A node joining this cluster must have at least two SSDs to match the tier it is entering. Cores and spindles matter less here than the flash. Bring fewer SSDs and you are not reinforcing the formation, you are slowing it down.

---

### ncp-mci-e1-q33

Due to application requirements, an administrator needs to modify an AHV VM to support a large number of distinct, concurrent network connections. The VM has below configuration: • 4 vCPUs • 20 GB RAM • OS: Microsoft Windows Server 2022 Which modification can improve network performance for network I/O-intensive applications running on this VM?

- ( ) Add more vCPUs
  > Incorrect: Adding more vCPUs can improve CPU-bound tasks but does not directly optimize network performance.
- ( ) Enable AHV Turbo Technology
  > Incorrect: AHV Turbo improves disk performance, not network performance.
- (x) Enable RSS VirtIO-Net Multi-Queue
  > Correct: RSS (Receive Side Scaling) VirtIO-Net Multi-Queue enhances network performance by distributing network traffic across multiple vCPUs.
- ( ) Add more RAM
  > Incorrect: Increasing RAM helps memory-intensive applications but does not improve network I/O.

@overall: Enabling RSS VirtIO-Net Multi-Queue optimizes network performance by allowing multiple CPU cores to process network packets in parallel, reducing bottlenecks for network I/O-intensive workloads.
@domain: networking
@difficulty: 3
@tags: virtio, multi-queue, rss, ahv
@briefing: A single network queue means a single vCPU doing all the packet work, and that one core saturates long before the wire does. Huge numbers of concurrent connections need the load spread. Enable RSS with VirtIO-Net Multi-Queue: receive-side scaling hands the queues out across multiple vCPUs so the VM can process traffic in parallel. More RAM will not fix a bottleneck that is only one core wide.

---

### ncp-mci-e1-q34

A consultant is configuring syslog monitoring and wants to receive CRITICAL logs from the Audit module. Which severity level setting should be configured to get the desired output?

- ( ) 0
  > Incorrect: Represents emergency logs.
- (x) 2
  > Correct: Represents critical logs.
- ( ) 5
  > Incorrect: Represents notice-level logs.
- ( ) 7
  > Incorrect: Represents debug-level logs.

@overall: The correct severity level to receive CRITICAL logs from the Audit module is 2. This corresponds to the Critical severity level in syslog. While other modules like SYSLOG_MODULE might require different configurations or log to different locations, for the Audit module itself, selecting level 2 will filter for Critical logs
@domain: monitoring
@difficulty: 2
@tags: syslog, severity, audit
@briefing: Syslog severity counts downward: the lower the number, the louder the alarm. Zero is emergency, one is alert, two is critical. You want CRITICAL logs out of the Audit module, so you set severity level 2. Set it to 0 and you hear only the end of the world. Set it to 5 or 7 and you drown in routine chatter — and a signal you cannot hear over the noise is the same as no signal at all.

---

### ncp-mci-e1-q35

An administrator is configuring Erasure Coding on a Redundancy Factor 2 Nutanix cluster. How many nodes, at a minimum, are necessary?

- ( ) 3
  > Incorrect: RF2 requires a minimum of three nodes but does not support Erasure Coding.
- (x) 4
  > Correct: Erasure Coding requires at least four nodes but is not optimal but in the question ask about minimum so answer is 4.
- ( ) 5
  > Incorrect: This is the optimal required for effective Erasure Coding.
- ( ) 6
  > Incorrect: Larger clusters improve resilience, but the minimum is four.

@overall: An administrator needs four nodes at a minimum to configure Erasure Coding on a Redundancy Factor 2 cluster. A six-node cluster with RF2 uses a stripe size of five, with four nodes for data and one for parity. The sixth node ensures availability for rebuild in case of node failure.
@domain: storage
@difficulty: 2
@tags: erasure-coding, rf2, node-count
@briefing: Erasure coding buys back capacity by storing parity instead of a whole second copy, but parity needs somewhere to live that is not with the data it protects. On an RF2 cluster the minimum is four nodes: enough distinct failure domains to hold the strip and its parity apart. Fewer than four and there is no honest way to spread it. Four nodes, RF2. That is the floor.

---

### ncp-mci-e1-q36

An administrator needs to perform an LCM upgrade on an AHV host with GPUs. What additional step is required for LCM to upgrade an AHV host that has GPUs?

- ( ) Create an agent VM on each host that has GPU drivers installed.
  > Incorrect: Agent VMs are not required for GPU updates.
- ( ) Run LCM in dark site mode so it can update AHV independently.
  > Incorrect: Dark site mode is used when internet access is unavailable but does not affect GPU upgrades.
- (x) Use Direct Uploads to upload appropriate driver bundles.
  > Correct: LCM does not automatically fetch GPU drivers. The administrator must download and manually upload the appropriate firmware bundle before upgrading.
- ( ) Update NCC to the latest version and re-run Inventory.
  > Incorrect: Updating NCC is a best practice but does not resolve GPU driver issues.

@overall: Before initiating the LCM upgrade on an AHV host with GPUs, upload the relevant NVIDIA vGPU AHV host driver bundle to the "Direct Uploads" section within Nutanix LCM. This ensures the correct driver is available during the upgrade process.
@domain: lifecycle
@difficulty: 2
@tags: lcm, gpu, drivers, direct-upload
@briefing: A GPU host is not a standard host, and LCM will not conjure the driver bundle it needs out of the void. Use Direct Uploads to supply the appropriate driver bundles before the upgrade, and LCM can then take the host through cleanly. Skip it and the upgrade stalls on the one node you least wanted to be arguing with.

---

### ncp-mci-e1-q37

An administrator is looking at the memory cluster runway diagram, as shown in the exhibit. The environment is based on three hosts with the following configuration: • CPU: 2x Intel Xeon Gold (8 cores, 2.6 GHz) • RAM: 256 GB per host • Storage: SSDs and HDDs The Prism Central Intelligent Operations feature has been active for one month, but no further configurations were applied. What does the dotted red line mean?

@image: ncp-mci-e1-q37.png
@image-alt: Memory cluster runway chart over 365 days. A dotted line labelled 'Effective Capacity (503.22 GiB)' slopes gently downward across the chart, above a solid blue consumption area that steps up sharply at 'TODAY'. Y-axis runs 0.00 GiB to 651.93 GiB.

- ( ) It is the default trend analysis static threshold that can be manually set.
  > Incorrect: Admins can manually configure thresholds, but this is not the meaning of the red line.
- ( ) It is the maximum memory the administrator can assign to VMs.
  > Incorrect: Memory allocation limits are set based on available resources, not the red line.
- (x) It is the calculated memory oversubscription limit for currently running VMs.
  > Correct: The dotted red line represents projected memory exhaustion based on trends.
- ( ) It is the usable capacity based on cluster configuration options.
  > Incorrect: Usable capacity is shown differently in Prism.

@overall: The dotted red line in the Prism Central memory cluster runway diagram represents the calculated memory oversubscription limit for the currently running VMs. This dotted red line is not a static threshold.
@domain: monitoring
@difficulty: 3
@tags: memory-runway, oversubscription, intelligent-operations
@briefing: That dotted red line on the memory runway is not a threshold somebody typed in, and it is not the usable capacity of the hardware. It is calculated: the memory oversubscription limit for the VMs currently running. It moves as the workload moves, because it is derived from the workload. Read it as a live ceiling, not a fence, and never mistake it for a number you are free to set yourself.

---

### ncp-mci-e1-q38

An administrator wants to change a cluster from Redundancy Factor 2 to 3, but it is not allowed. What must the administrator check?

- ( ) Check that the cluster has been properly licensed.
  > Incorrect: Licensing does not affect RF settings.
- (x) Check that the cluster has five or more nodes.
  > Correct: RF3 requires a minimum of five nodes.
- ( ) Check hardware availability of the nodes.
  > Incorrect: Hardware availability does not restrict RF changes.
- ( ) Check AOS version and upgrade, if needed.
  > Incorrect: AOS version must support RF3, but the main factor is node count.

@overall: The administrator should check that the cluster has five or more nodes. A minimum of five nodes per cluster is required for Redundancy Factor 3 (RF3).
@domain: architecture
@difficulty: 2
@tags: redundancy-factor, rf3, node-count
@briefing: The cluster is refusing to go from Redundancy Factor 2 to 3, and it is right to refuse. RF3 keeps a third copy of the data and five copies of the metadata, and that needs enough independent nodes to hold them apart. The floor is five nodes. Count them. If you have four, the answer is not to argue with the cluster — it is to add hardware.

---

### ncp-mci-e1-q39

Which storage container option reduces the available storage to other containers?

- ( ) Advertised Capacity
  > Incorrect: This sets a soft quota but does not reduce actual storage.
- ( ) Erasure Coding
  > Incorrect: Erasure coding optimizes storage but does not restrict other containers.
- ( ) Capacity Deduplication
  > Incorrect: Deduplication optimizes space but does not reserve storage.
- (x) Reserved Capacity
  > Correct: Ensures a fixed amount of storage is allocated, reducing availability for other containers.

@overall: Reserving capacity for a storage container or setting an advertised capacity limits the available storage to other containers within the same storage pool. By default, all containers share the unused space in a pool. However, with reservations or advertised capacity, a specific amount of storage is allocated to a particular container and becomes unavailable for other containers to utilize.
@domain: storage
@difficulty: 2
@tags: storage-container, reserved-capacity, advertised-capacity
@briefing: Reserved Capacity is a claim staked on the storage pool. Set it on a container and that space is fenced off for that container alone — which means it is taken away from everyone else, whether or not it is ever used. That is the option that shrinks what the other containers can see. Reserve deliberately. Every gigabyte you promise to one container is a gigabyte the rest of the station cannot touch.

---

### ncp-mci-e1-q40

An administrator wants to collect log files that have been requested by Nutanix Support team. From which Prism Element dashboard can this be accomplished?

- ( ) Settings
  > Incorrect: Used for general system configurations, not log collection.
- ( ) Alerts
  > Incorrect: Displays system alerts but does not collect logs.
- (x) Health
  > Correct: The Health dashboard provides an option to generate and download log bundles.
- ( ) Analysis
  > Incorrect: Provides insights but does not collect logs.

@overall: An administrator can collect log files requested by Nutanix Support from the Prism Element dashboard by navigating to the Health page and selecting Actions → Collect Logs. This process utilizes the Logbay utility, which allows for flexible log collection and can be further customized from the command line interface (CLI). Within the Collect Logs section of the Prism Element dashboard, you can specify the nodes and tags for targeted log collection, define the duration of logs to collect, and select the destination for the collected logs.
@domain: monitoring
@difficulty: 1
@tags: log-collection, ncc, support, prism-element
@briefing: Support is asking for logs and the clock is running. In Prism Element, log collection lives on the Health dashboard — the same place the cluster reports how it feels, which is exactly where you would look if you thought about it for a second. Not Settings, not the VM view. Health. Gather the bundle, hand it over, and let them work.

---

### ncp-mci-e1-q41

An administrator receives an alert: "A node cannot enter maintenance mode." What could be the cause of this alert?

- (x) Other nodes in the cluster may not have enough resources available.
  > Correct: Insufficient resources prevent nodes from entering maintenance mode.
- ( ) Another node in this cluster is already in maintenance mode.
  > Incorrect: Clusters allow only one node at a time in maintenance mode, but this is not the cause of this alert.
- ( ) This node in the cluster is already in maintenance mode.
  > Incorrect: If a node was already in maintenance mode, this alert would not appear.
- ( ) This node in the cluster may not have enough resources available.
  > Incorrect: Resource availability may affect VM migrations, but maintenance mode is restricted by existing maintenance sessions.

@overall: The most likely cause for a node failing to enter maintenance mode is that the cluster is in a critical High Availability (HA) state. When HA is critical, it means there aren't enough resources available to restart VMs on other nodes if the node entering maintenance mode fails.
@domain: lifecycle
@difficulty: 2
@tags: maintenance-mode, alerts, resources
@briefing: A node cannot enter maintenance mode, and the reason is almost never the node itself. Maintenance mode means evacuating the VMs to somewhere else in the cluster. If the surviving nodes do not have the CPU and memory free to take them, there is nowhere to evacuate to, and the cluster stops rather than dropping workloads on the floor. That refusal is the cluster protecting you. Make room, then try again.

---

### ncp-mci-e1-q42

An administrator is conducting LCM updates in a Nutanix cluster and is being prompted for handling non-migratable VMs. Which VM type is non-migratable?

- ( ) VMs without NGT
  > Incorrect: Nutanix Guest Tools (NGT) are used for guest-level integration but do not affect VM migratability.
- (x) VMs marked as an Agent
  > Correct: Agent VMs are system-critical and cannot be migrated.
- ( ) Memory Overcommitted
  > Incorrect: While memory overcommitment can affect performance, it does not make VMs non-migratable. Nutanix AHV handles memory allocation dynamically.
- ( ) VMs with attached Volume Groups
  > Incorrect: as the iSCSI connections used by Volume Groups directed to the data services IP, so VMs with VG can be migrated seamlessly.

@overall: Agent VMs are indeed non-migratable. Other non-migratable VM types include those with CPU passthrough, GPU passthrough, PCI passthrough, and VMs with host affinity policies configured. During host maintenance, these VMs are typically shut down and powered back on after the maintenance is complete.
@domain: vms
@difficulty: 2
@tags: agent-vm, migration, lcm, maintenance-mode
@briefing: The upgrade is asking what to do with the VMs it cannot move. Agent VMs are the ones it means. They are pinned to their host by design — that is the whole point of the flag — so they will not live-migrate away during an LCM update, and the cluster has to power them off instead. Know which of your machines are Agents before you start an upgrade, not while it is waiting on you.

---

### ncp-mci-e1-q43

When is deduplication recommended?

- ( ) Server workloads
  > Incorrect: Deduplication is not highly beneficial for server workloads as they often have unique data.
- ( ) Linked Clone VMs
  > Incorrect: Linked clones share data blocks, making deduplication efficient.
- (x) Full clone VMs
  > Correct: Full clones have identical data blocks, benefiting from deduplication.
- ( ) Cold data
  > Incorrect: Deduplication is typically used for active data rather than cold storage.

@overall: Nutanix recommends enabling deduplication for full clone VMs, persistent desktops, and P2V. VDI workloads using full clones also benefit from deduplication. Server workloads, linked clone VMs, and VAAI clones generally see less benefit. It's not recommended for instant clones or data that is accessed infrequently (cold data).
@domain: storage
@difficulty: 2
@tags: deduplication, full-clone, efficiency
@briefing: Deduplication earns its overhead only when there is genuine duplication to find. Full clone VMs are the textbook case: each clone carries its own complete copy of an almost identical image, so the redundancy is enormous and dedup collapses it. Data that is already unique gains nothing and still pays the CPU and memory cost of being hashed. Deduplicate where things are copies. Everywhere else, it is a tax.

---

### ncp-mci-e1-q44

Within Prism Central, which Compute and Storage section will allow an administrator to upload a Windows ISO file?

- ( ) Catalog Items
  > Incorrect: as this is used to manage preconfigured application templates.
- ( ) Templates
  > Incorrect: Used for VM templates, not for storing ISO files.
- (x) Images
  > Correct: as it allows uploading and managing ISO and disk images.
- ( ) OVAs
  > Incorrect: as this pertains to importing virtual appliances, not ISO files.

@overall: The section within Prism Central where an administrator can upload a Windows ISO file is called "Image Configuration," found under the "Compute and Storage" section. This area allows for uploading ISO files, which are then used for creating virtual machines. The process typically involves selecting "Upload Image," filling in the required information (such as name and description), and choosing the source ISO file to upload.
@domain: vms
@difficulty: 1
@tags: images, iso, prism-central
@briefing: You have a Windows ISO and you need it where the cluster can build from it. In Prism Central, under Compute and Storage, that is the Images section. Images is the armoury: ISOs and disk images land there once and every VM you create afterwards can draw from them. Upload it there and it is available fleet-wide.

---

### ncp-mci-e1-q45

An administrator needs to create a VM Template from an existing VM. What is required for this action to be successful?

- ( ) Sysprep or Cloud-init script.
  > Incorrect: Helps with VM customization but is not required for template creation.
- ( ) The VM is powered on.
  > Incorrect: as a template cannot be created while the VM is running.
- ( ) Windows OS is installed.
  > Incorrect: Not required; a template can be created from any VM state.
- (x) The VM is powered off.
  > Correct: Required to create a template successfully.

@overall: To successfully create a VM template from an existing VM, the source VM must be powered off. Once powered off, you can initiate the template creation process. A template name and, optionally, a description are required when creating the template. You can customize the guest OS settings, and choose whether users can override these settings during VM deployments. Once created, the template metadata is stored in Prism Central, with the data itself stored as a VM recovery point on the same cluster as the source VM. The original VM remains, and can be powered back on at any time.
@domain: vms
@difficulty: 1
@tags: vm-template, power-state
@briefing: You cannot take a clean cast of a machine that is still moving. Creating a VM Template from an existing VM requires that VM to be powered off — a running machine has memory in flight and disks mid-write, and a template taken from that is a template of a moment that never quite existed. Shut it down, then take the mould.

---

### ncp-mci-e1-q46

An administrator has spent time correcting specific issues that have been identified by NCC Health Checks in Prism Element (PE). How can just the checks that previously did not pass be executed again to confirm they are all resolved?

- ( ) Run LCM Pre-Upgrade to trigger NCC Checks.
  > Incorrect: Triggers checks but includes all, not just failed ones.
- ( ) Run ncc health checks run_all.
  > Incorrect: Runs all checks, not just failed ones.
- ( ) Select Run Check for each check worked.
  > Incorrect: Can be done manually but is inefficient.
- (x) Select Only Failed And Warning Checks.
  > Correct: The correct option, as it reruns only failed and warning checks.

@overall: Running only failed and warning checks helps verify issue resolution efficiently.
@domain: monitoring
@difficulty: 2
@tags: ncc, health-checks, prism-element
@briefing: You have spent the shift fixing what the health checks flagged. Do not now re-run the entire battery and wait for the ones that were already green. Select Only Failed And Warning Checks and NCC re-runs precisely the checks that did not pass, so you get your confirmation in a fraction of the time. Verify the repair, not the whole hull.

---

### ncp-mci-e1-q47

What is the purpose of the OpLog?

- (x) Persistent write buffer
  > Correct: The correct option, as OpLog is used for storing incoming writes before committing them to storage.
- ( ) Persistent data storage
  > Incorrect: OpLog is not a long-term storage mechanism.
- ( ) Global metadata
  > Incorrect: OpLog does not store metadata, it handles write operations.
- ( ) Dynamic read cache
  > Incorrect: OpLog is primarily for writes, not read caching.

@overall: The OpLog (Operational Log) in Nutanix serves as apersistent write bufferfor incoming I/O operations. It temporarily stores write requests to ensure fast acknowledgment to clients and better performance. The data is later coalesced and written to the Extent Store for long-term storage.
@domain: storage
@difficulty: 1
@tags: oplog, write-path, extent-store
@briefing: Every write we take has to be safe before we can acknowledge it, and it has to be fast or the whole station stalls. The OpLog is how we get both: a persistent write buffer on flash. Writes land there, are coalesced, and are later drained down into the Extent Store, which is the durable capacity tier. The OpLog is not the tier itself. It is the landing pad in front of it.

---

### ncp-mci-e1-q49

An administrator observes an alert in Prism for a hybrid SSD/HDD cluster: 1 "Storage Pool SSD utilization consistently above 75%." What is the potential impact of this condition?

- ( ) The cluster is unable to sustain an SSD disk failure.
  > Incorrect: SSD failures are managed via redundancy policies (RF2/RF3), and high utilization does not impact failure handling
- ( ) The cluster may be nearly out of storage for metadata.
  > Incorrect: Metadata is stored separately, and high SSD usage does not mean metadata is at risk.
- ( ) The cluster is at risk of entering a read-only state.
  > Incorrect: Clusters do not go into read-only mode due to high SSD utilization---they simply experience performance degradation
- (x) Average I/O latency in the cluster may increase.
  > Correct: High SSD utilization can slow performance.

@overall: High SSD utilization in a hybrid cluster can lead to increased I/O latency as new writes may spill over to HDDs, reducing overall performance. If SSD usage is above 75%, data tiering shifts to slower HDDs, increasing latency.
@domain: performance
@difficulty: 2
@tags: ssd, storage-pool, latency, tiering
@briefing: SSD utilization holding above seventy-five percent is a warning about speed, not about running out of room. The hot tier is where the working set lives; when it is that full, there is less space to absorb incoming writes and more data gets pushed down to spinning disk. The consequence is felt everywhere at once: average I/O latency across the cluster starts to climb. It is not a capacity alarm. It is a performance one.

---

### ncp-mci-e1-q52

A company is evaluating Nutanix DR to protect some business-critical applications and tasked an administrator to find an optimal configuration providing highest resiliency and lowest RPO to the production environment. The company's production environment is deployed on two physical sites with each hosting one AHV-based cluster. What configuration will meet the company's requirements?

- ( ) Deploy Prism Central instance on one of the sites. Configure NearSync replication using Protection Domains.
  > Incorrect: NearSync replication provides low RPO but may not offer the highest resiliency.
- ( ) Deploy one Prism Central instance on each site and configure synchronous replication using Protection Policy.
  > Incorrect: Synchronous replication provides the highest resiliency and lowest RPO.
- ( ) Deploy Prism Central instance on one of the sites, configure Prism Central Disaster Recovery, and setup Metro AHV.
  > Incorrect: This option provides good resiliency but may not offer the lowest RPO.
- (x) Deploy Prism Central instance on each site. Configure Metro Availability using Protection Domains.
  > Correct: Metro Availability provides high resiliency and low RPO.

@overall: Metro Availability offers the lowest RPO (zero) and highest resiliency: Metro Availability, leveraging synchronous replication, ensures zero data loss and near-zero RTO in a failover scenario. This is the best option for business-critical applications requiring continuous availability. Since the company has two sites, placing Prism Central on each site provides management redundancy. Protection Domains can also be used as part of this Configuration: Setting up Protection Domains within the Metro Availability configuration enhances disaster recovery capabilities, providing options for granular VM protection and orchestration for less critical applications. These would likely be configured with NearSync replication within the same Prism Central instance. Other options are suboptimal: the single-site NearSync configuration and the synchronous-replication Protection Policy are not ideal because NearSync and synchronous replication alone don't offer the automatic failover and near-zero RTO provided by Metro Availability. The Prism Central Disaster Recovery + Metro AHV configuration is incorrect because the company has two clusters (one in each site); this would imply that there's a dedicated site for DR which the question does not support.
@domain: data-protection
@difficulty: 3
@tags: metro-availability, protection-domain, rpo, dr
@briefing: Highest resiliency and the lowest possible RPO is a demanding pair of words. Asynchronous replication cannot give it to you: there is always a gap between the last snapshot and the failure. Metro Availability closes that gap by keeping the two sites synchronously in step, so the RPO approaches zero. Deploy a Prism Central instance at each site and configure Metro Availability using Protection Domains. Lowest RPO means synchronous. Everything else is a compromise dressed up as a plan.

---

### ncp-mci-e1-q53

Which predefined view should be leveraged in Prism Central Intelligent Operations to determine which VM is consuming too many resources and causing other VMs to starve?

- ( ) Constrained VMs List
  > Incorrect: This view shows VMs that are constrained by resource limits.
- (x) Bully VMs List
  > Correct: This view shows VMs that are consuming excessive resources and causing other VMs to starve.
- ( ) Inactive VMs List
  > Incorrect: This view shows VMs that are inactive and not consuming resources.
- ( ) Overprovisioned VMs List
  > Incorrect: This view shows VMs that are overprovisioned with resources.

@overall: The "Bully VMs List" in Prism Central Intelligent Operations (formerly called AIOps) specifically identifies VMs consuming excessive resources and impacting the performance of other VMs by "stealing" resources from them. While other options might provide insights into resource usage, they do not directly address the issue of one VM negatively affecting others.
@domain: monitoring
@difficulty: 2
@tags: bully-vms, intelligent-operations, contention
@briefing: One machine is eating the cluster and the rest are starving in its wake. Prism Central has a predefined view for exactly that offender: the Bully VMs list. It surfaces the VMs whose resource consumption is degrading everyone around them, so you are not hunting through charts trying to catch the culprit by hand. Find the bully first. Everything downstream of it is a symptom.

---

### ncp-mci-e1-q55

An administrator has been tasked by the company's leadership to justify and explain the decision to utilize the new Nutanix Disaster Recovery solution. The environment contains: • 100 workloads • Workloads have varying boot orders • Workloads span multiple subnets • Workloads span across different business units How should the administrator most efficiently organize and manage the workloads?

- (x) Utilize Categories to organize VMs in Recovery Plans.
  > Correct: Categories help organize VMs efficiently.
- ( ) Utilize RESTful APIs to script creation of Recovery Plans.
  > Incorrect: While APIs offer automation capabilities, they don't inherently provide organizational structure. You would still need a method for grouping VMs logically within the Recovery Plans created by the scripts.
- ( ) Utilize a 1:10 ratio of Recovery-Plan to VMs.
  > Incorrect: This might be a workable approach, but it doesn't directly address the organizational challenges presented by boot orders, subnets, and business units. It could lead to unnecessary complexity with a large number of Recovery Plans.
- ( ) Utilize a VM naming schema that allows sorting.
  > Incorrect: A good naming schema is helpful, but it doesn't replace the need for grouping and orchestrating VMs within Recovery Plans based on dependencies and business requirements. Sorting alone won't manage boot orders or subnet dependencies during recovery.

@overall: Utilizing Categories to organize VMs in Recovery Plans is the most efficient method. Categories are designed specifically for grouping VMs logically within Recovery Plans. They allow the administrator to manage workloads based on boot order, subnet, business unit or any other criteria relevant to disaster recovery. This approach simplifies recovery orchestration significantly compared to other options.
@domain: data-protection
@difficulty: 2
@tags: categories, recovery-plan, dr, boot-order
@briefing: A hundred workloads with different boot orders, and you are not going to name them one at a time in a Recovery Plan and keep that list correct for a year. Use Categories. Group the VMs by what they are and when they need to come up, then build the Recovery Plan against the Categories. New VM joins a category, it is protected automatically. Describe the fleet once; let the plan follow the description.

---

### ncp-mci-e1-q56

An administrator has been tasked with creating a new storage container named TestData. The TestData storage container must meet the following conditions: • The container needs to have a Replication Factor of 1 (RF1). • Inline Compression must be enabled. • Deduplication must be disabled. • The container must have a maximum storage capacity of 100 GiB. How should the administrator complete this task?

- ( ) Log into Prism Element and create the storage container.
  > Incorrect: This approach uses Prism Element, which is designed for cluster-local management, including creation of containers with advanced features. However, this option is vague and does not specify setting the capacity (maximum 100 GiB) as required, so it may not enforce the capacity limit directly.
- ( ) Log into Prism Central and create the storage container with a Reserved Capacity of 100 GiB.
  > Incorrect: Prism Central provides centralized management for multiple clusters . Setting Reserved Capacity does not guarantee enforcement of a hard storage limit, so this does not fully satisfy the requirement for strictly limiting container size. Some advanced settings might not be as granular as in Prism Element when configuring storage features at creation time.
- (x) Log into Prism Element and create the storage container with an Advertised Capacity of 100 GiB.
  > Correct: In Prism Element, when creating storage containers, you can set specific features such as Replication Factor (RF1), enable inline compression, disable deduplication, and—critically—set "Advertised Capacity" to 100 GiB, which enforces the storage limit. Prism Element gives you cluster-local control to configure all required features at creation, which is not as easily handled in Prism Central's broader policy management view.
- ( ) Log into Prism Central and create the storage container.
  > Incorrect: Prism Central is usually best for environments with multiple clusters, centralized policy management, and automation, but it may not expose all granular features required for specific container customizations (like Replication Factor, compression, deduplication, and explicit advertised capacity limits) at creation time. Without specifying reserved or advertised capacity, this approach is incomplete versus the scenario's requirements.

@overall: • Prism Element is ideal for managing individual clusters and is the only platform that reliably allows configuration of all required storage container properties at creation, such as Replication Factor, compression, deduplication, and advertised (hard capped) capacity. • Prism Central, while powerful for multi-cluster and global management, does not provide the same level of granularity for storage container creation on a single cluster, especially when enforcing a strict capacity limit and choosing advanced features. • The Advertised Capacity setting in Prism Element is essential to enforce the 100 GiB limit; other methods may not provide a hard cap or could skip key configuration details. • Therefore, creating the container in Prism Element with an Advertised Capacity of 100 GiB directly satisfies all requirements in the scenario, making it the preferred choice for Nutanix storage container creation with strict settings.
@domain: storage
@difficulty: 3
@tags: storage-container, rf1, advertised-capacity, prism-element
@briefing: Four requirements, and only one console can satisfy all four at creation. Prism Element is where a storage container's full property set lives: replication factor down to RF1, inline compression on, deduplication off, and a hard cap on size. That cap is Advertised Capacity — 100 GiB advertised is the limit the container will honour. Reserved Capacity is the opposite instrument: it fences space off for this container and takes it from everyone else. Advertised caps. Reserved claims. Do not confuse the two.

---

### ncp-mci-e1-q58

A new employee has inherited a partially configured Disaster Recovery (DR) schema. Source workloads have been identified and Nutanix Guest Tools has been installed. There are two Protection Polices in place, one with an asynchronous schedule with a 1-hour RPO and a second policy utilizing synchronous replication. All of these workloads need to be recovered at a DR location and this will be orchestrated by Prism Central Recovery Plans. What is the best way to setup this recovery orchestration?

- (x) Setup a single Recovery Plan utilizing stages of recovery delays as needed.
  > Correct: Nutanix recommends an application-centric approach to DR. You can (and should) create a single Recovery Plan that includes VMs protected by both synchronous and asynchronous replication policies, as long as they belong to the same application or business service. The plan can use stages and delays to handle boot order and dependencies, orchestrating a smooth failover.
- ( ) Identify the workload startup order and create Recovery Plans corresponding to the startup order.
  > Incorrect: Startup order should be managed inside a single Recovery Plan using stages and delays — not by splitting into separate Recovery Plans.
- ( ) Setup two Recovery Plans, one for the asynchronous replication and one for the synchronous replication.
  > Incorrect: Splitting by replication type breaks the application into multiple plans, forcing operators to coordinate failover manually across different plans — which defeats the purpose of automated recovery orchestration.
- ( ) Setup a Recovery Plan for the asynchronous replication and convert the synchronous replication to a Protection Domain.
  > Incorrect: Modern Prism Central Recovery Plans work with Protection Policies directly; converting to Protection Domains adds complexity and is unnecessary.

@overall: Nutanix Disaster Recovery is built to orchestrate failover at the application level, not by replication technology. You can include VMs protected by different Protection Policies (both sync and async) in the same Recovery Plan, and then use stages to define the boot sequence. This keeps DR simple, coordinated, and aligned to real-world business needs — ensuring that an entire application stack can be recovered with a single action.
@domain: data-protection
@difficulty: 3
@tags: recovery-plan, stages, boot-order, dr
@briefing: Two Protection Policies, one synchronous and one asynchronous, and an instinct to build a Recovery Plan for each. Resist it. A Recovery Plan is not tied to a single policy; it is the running order for the recovery. Build one Recovery Plan and use stages, with delays between them, so the machines come up in the order the applications actually require. Split it in two and nothing coordinates the sequence across them. One plan. Staged.

---

### ncp-mci-e1-q59

Within Intelligent Operations, Capacity Configurations have been set to Auto Detect for Reserve Capacity For Failure. For an RF2 cluster with 10 nodes, what effect does this have on Capacity Runway?

- ( ) Reserves 10% of CPU, memory and storage to account for a single node failure.
  > Incorrect: The system doesn’t reserve a flat percentage; instead, it reserves capacity equal to the impact of losing the largest node in the cluster.
- ( ) Reserves RAM and CPU from the fastest node to account for a single node failure.
  > Incorrect: Nutanix doesn’t consider “fastest” node in terms of CPU clock speed or performance. The calculation is based on capacity, not performance.
- (x) Reserves CPU, RAM and storage from the largest node to account for a single node failure.
  > Correct: When Capacity Configurations > Reserve Capacity For Failure is set to Auto Detect, Nutanix Intelligent Operations automatically reserves enough CPU, RAM, and storage to handle the failure of the largest node in the cluster. This ensures that, in an RF2 cluster, a single node failure can be tolerated without impacting workload availability.
- ( ) Reserves storage and memory from the largest node to account for a single node failure.
  > Incorrect: This option ignores CPU, which is also included in the reservation calculation. Nutanix reserves all three: CPU, memory, and storage.

@overall: For an RF2 cluster, “Auto Detect” dynamically calculates and reserves the amount of capacity required to absorb the failure of the single largest node — across all three dimensions: CPU, memory, and storage. This keeps the cluster protected and ensures Capacity Runway calculations accurately reflect the true usable capacity after accounting for node failure tolerance.
@domain: monitoring
@difficulty: 2
@tags: reserve-capacity, auto-detect, capacity-runway, rf2
@briefing: Auto Detect does not reserve a tidy ten percent, and it does not pick the fastest node. It looks at the cluster and reserves enough CPU, memory, and storage to survive the loss of the largest node — because that is the worst single failure the cluster can actually suffer. All three dimensions, sized to the biggest hull in the formation. Capacity Runway then projects against what is genuinely left over, not against a number that assumes nothing ever breaks.
