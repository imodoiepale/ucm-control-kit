# Running many sites on one UCM

## Sources of truth

| Source | Holds |
|---|---|
| Site registry (your JSON/DB) | Site identity: name, aliases, subnet, contact, recorded extension |
| Snapshot | The last known-good settings of each extension, saved whenever it is healthy |
| PBX | What is live now |

Always show where these three disagree. Never silently pick one.

## Conventions that make automation reliable

- **Display names:** the UCM display name is exactly the site name, so reconcile matches with confidence 1.0.
- **Numbering:** a numbering plan per region (for example 1000–1099 Nairobi, 1100–1199 Coast). Don't reuse a number within 30 days.
- **Addressing:** one /24 per site. Reconcile uses the phone's registered IP as a second signal.
- **Extension template:** one template for every extension (codecs, NAT, permitted IP, voicemail, call permission). Drift is measured against it.
- **Staff lines:** keep staff and back-office extensions (reception, accounts) in a separate range or department, so they never look like missing sites.

## Onboarding a new site (wizard order)

1. Identity and contact
2. Network: subnet, gateway, PC, VPN name
3. Machines
4. Cameras and NVR
5. Extension phones: next free number, display name = site name
6. Provision the phone and wait for it to show registered
7. Test call to a partner site
8. Review the rule checks, then go live and start monitoring

## Auto-heal levels

- **observe:** alerts only. Start here.
- **suggest:** a one-click fix, with a diff.
- **auto:** only restores extension settings from the snapshot. Phone-side and network causes always need a human.

## Daily routine

- **Night:** audit, reconcile, a test call per site, and a drift report.
- **Morning:** clear the red items.
- **During the day:** alerts only, with a 2-minute grace period for offline phones and quiet hours for warnings. Critical alerts (PBX down, trunk down, extension removed) always fire.

## Security

- Give the API user only the permissions it needs, and turn on its IP allowlist.
- Rotate its password. Don't paste it into chats or tickets.
- Disable the legacy HTTPS API, or at least change its default `cdrapi` password and restrict it by IP.
- Log every write with who approved it.
