---
name: dhcp-ipv6-tester
description: Deep analysis of DHCPv4 and IPv6 RA/ND behaviour. Use for DHCP/IPv6 failures or questions.
---
# DHCP and IPv6 tester

## Procedure
1. `get_report` / `get_test_definition` to see which check failed and its evidence frames.
2. DHCPv4 (TC-DHCP-001): walk the DORA exchange with `query_packets` on `capture-lan`.
   - Count Discovers before the first Offer: retries mean the server was not answering yet.
   - Timing: t0 = `netifd: Interface 'lan' is now up` (dut-syslog, 1 s resolution), t1 = first ACK.
   - Note the transaction ID (`dhcp.id`); retries of one client keep it.
3. Correlate with dut-syslog: `search_logs` for `dnsmasq`, `dnsmasq-dhcp`, `netifd`, and any service that
   starts between t0 and the first Offer (`get_timeline` from t0 − 5 s to t1 + 5 s).
   A late `dnsmasq[...]: started` line explains unanswered Discovers.
4. IPv6 (TC-IPV6-002): list RAs and inspect fields:
   - router lifetime 0 = "not a default router" — clients lose the IPv6 default route;
   - missing RDNSS (option 25) = clients get no IPv6 DNS server;
   - prefix information (L, A flags, lifetimes) and MTU option.
5. Correlate RA content with `odhcpd` lines in dut-syslog (warnings about overridden defaults) and with the
   firmware release notes.

## Display-filter cheat sheet
| Filter | Meaning |
|---|---|
| `dhcp.option.dhcp == 1` / `2` / `3` / `5` | Discover / Offer / Request / ACK (`6` = NAK) |
| `dhcp && ip.src == 192.168.10.1` | DHCP sent by the DUT |
| `icmpv6.type == 133` | Router Solicitation |
| `icmpv6.type == 134` | Router Advertisement |
| `icmpv6.nd.ra.router_lifetime == 0` | RA that withdraws the default route |
| `icmpv6.opt.type == 25` | RDNSS option present |
| `icmpv6.type == 134 && !(icmpv6.opt.type == 25)` | RA without RDNSS |
| `icmpv6.type == 135` / `136` | Neighbor Solicitation / Advertisement |

## Output
Timeline table (time, source, event, `[[ev:…]]`), then the mechanism in 1–3 sentences and the component.

## Rules
- Use display filters and time windows; never dump whole captures.
- Syslog has 1 s resolution: do not claim sub-second precision for log events.
- A defect seen in another test's capture (e.g. RA lifetime 0 in a DHCP capture) is the same defect, not a new one.
