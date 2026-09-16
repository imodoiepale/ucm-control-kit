# Platforms

## Tested on hardware

| Field | Value |
|---|---|
| Model | Grandstream UCM6304 (V1.6A) |
| Firmware | 1.0.33.30 (base, prog, boot, core, rcvr, lang); GS Wave 1.0.33.14 |
| API | HTTPS API "API Settings (New)", `POST /api` on port 8089 |
| Date | 2026-09 |

Verified actions: `getSIPAccount` (returns the SIP and voicemail passwords in clear text; the kit masks them), `challenge`, `login`, `logout`, `getSystemStatus`, `getSystemGeneralStatus`, `listAccount`, `listVoIPTrunk`, `listAnalogTrunk`, `listInboundRoute`, `listOutboundRoute`, `listQueue`, `listIVR`, `listPagingGroup`, `listDepartment`, `listBridgedChannels`, `listUnBridgedChannels`, `listIPC`.

These returned `-47` until the permission was granted: `listDigitalTrunk`, `listRingGroup`, `listVoicemailGroup`, `listConference`.

## From Grandstream's API guide, not yet verified here

`addSIPAccount`, `updateSIPAccount`, `applyChanges`, `dialExtension`, `dialOutbound`, `Hangup`, `callTransfer`, `cdrapi`.

Run `ucm probe` to check them on your unit. Please report the results with the "Platform report" issue template.

## Notes

- `listAccount` reports `account_type` as `SIP(WebRTC)` for extensions with WebRTC enabled. `status` is `Idle` when a phone is registered and `Unavailable` when none is.
- `addr` looks like `192.168.14.159:5060 (GXP1615)`. The kit splits it into `ip`, `port` and `model`.
- Lists are paginated (`page`, `item_num`, `total_page`). The client fetches every page.
- The **HTTPS API Settings (Old)** tab (CDR/REC/PMS only, default user `cdrapi`) is deprecated by Grandstream.
- `cdrapi` returned JSON with no `status` field; the client accepts that shape. Record fields still to be confirmed with `ucm probe`.
- `listZeroConfig` returned -47, so phones cannot yet be provisioned remotely through the API.
