# UCM API status codes and login

## Login flow

1. `{"request":{"action":"challenge","user":"<user>","version":"1.0"}}` returns `response.challenge`.
2. `token = md5(challenge + password)`, as lowercase hex.
3. `{"request":{"action":"login","user":"<user>","token":"<token>"}}` returns `response.cookie`.
4. Send `"cookie": "<cookie>"` with every later request. Log out with `{"action":"logout","cookie":...}`.

The UCM uses a self-signed certificate by default. The kit accepts it unless `insecure: false` is set.

## Status codes seen in practice

| Status | Meaning | What to do |
|---|---|---|
| 0 | Success | |
| -6, -8 | Session expired | Log in again. The client does this automatically once |
| -37 | Wrong username or password | Check `UCM_USER` and `UCM_PASSWORD` |
| -47 | No permission | On a `challenge`: the API user is not saved, "Enable API" is off, or the caller IP is not on the user's allowlist. On other actions: tick that permission on the API user |
| -68 | Login restricted | Too many failed logins; wait, or check the UCM's login security settings |

## Permission groups on the API user page

The permission tree is grouped by area. Groups seen on firmware 1.0.33.30 include Call Control, CDR, Contacts and Device Management, and more appear further down the page. Grant only what the integration needs. For monitoring only: the list/get actions. For test calls, add `dialExtension`.

## Actions verified on UCM6304 1.0.33.30

`getSystemStatus`, `getSystemGeneralStatus`, `listAccount`, `listVoIPTrunk`, `listAnalogTrunk`, `listInboundRoute`, `listOutboundRoute`, `listQueue`, `listIVR`, `listPagingGroup`, `listDepartment`, `listBridgedChannels`, `listUnBridgedChannels`, `listIPC`.

`listAccount` rows include `extension`, `fullname`, `status` (`Idle` = registered, `Unavailable` = no phone), `addr` (`ip:port (model)` or `-`), `account_type`, `out_of_service`, `presence_status`, `department_name`. Results are paginated with `page`, `item_num` and `total_page`.

Run `ucm probe` to check `getSIPAccount`, `cdrapi` and zero-config on your firmware.
